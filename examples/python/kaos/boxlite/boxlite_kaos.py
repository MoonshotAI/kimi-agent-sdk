from __future__ import annotations

import asyncio
import base64
import json
import posixpath
import shlex
from collections.abc import AsyncGenerator, Iterable
from pathlib import PurePosixPath
from typing import TYPE_CHECKING, Literal

import boxlite
from kaos import AsyncReadable, AsyncWritable, Kaos, KaosProcess, StatResult, StrOrKaosPath
from kaos.path import KaosPath

if TYPE_CHECKING:

    def type_check(boxlite_kaos: BoxliteKaos) -> None:
        _: Kaos = boxlite_kaos


class _BoxliteStdin:
    def __init__(self, stdin: boxlite.ExecStdin) -> None:
        self._stdin = stdin

    def can_write_eof(self) -> bool:
        return True

    def close(self) -> None:
        self._stdin.close()

    async def drain(self) -> None:
        return None

    def is_closing(self) -> bool:
        return self._stdin.is_closed()

    async def wait_closed(self) -> None:
        return None

    def write(self, data: bytes) -> None:
        if self._stdin.is_closed():
            return
        payload = data if isinstance(data, (bytes, bytearray)) else bytes(data)
        self._stdin.send_input(payload)

    def writelines(self, data: Iterable[bytes], /) -> None:
        for chunk in data:
            self.write(chunk)

    def write_eof(self) -> None:
        self.close()


class _BoxliteProcess:
    def __init__(self, execution: boxlite.Execution) -> None:
        self._execution = execution
        self._stdout = asyncio.StreamReader()
        self._stderr = asyncio.StreamReader()
        self._stdin = _BoxliteStdin(execution.stdin())
        self.stdin: AsyncWritable = self._stdin
        self.stdout: AsyncReadable = self._stdout
        self.stderr: AsyncReadable = self._stderr
        self._returncode: int | None = None
        self._exit_future: asyncio.Future[int] = asyncio.get_running_loop().create_future()
        self._stdout_task = asyncio.create_task(self._pipe_stream(execution.stdout(), self._stdout))
        self._stderr_task = asyncio.create_task(self._pipe_stream(execution.stderr(), self._stderr))
        self._monitor_task = asyncio.create_task(self._monitor())

    @property
    def pid(self) -> int:
        return -1

    @property
    def returncode(self) -> int | None:
        return self._returncode

    async def wait(self) -> int:
        return await self._exit_future

    async def kill(self) -> None:
        await self._execution.kill()

    async def _pipe_stream(
        self, stream: AsyncGenerator[bytes], reader: asyncio.StreamReader
    ) -> None:
        try:
            async for chunk in stream:
                if isinstance(chunk, (bytes, bytearray)):
                    reader.feed_data(bytes(chunk))
                else:
                    reader.feed_data(str(chunk).encode("utf-8", "replace"))
        except Exception as exc:
            reader.feed_data(f"[boxlite stream error] {exc}\n".encode("utf-8", "replace"))
        finally:
            reader.feed_eof()

    async def _monitor(self) -> None:
        exit_code = 1
        try:
            result = await self._execution.wait()
            exit_code = result.exit_code
        except Exception as exc:
            self._stderr.feed_data(f"[boxlite command error] {exc}\n".encode("utf-8", "replace"))
        finally:
            self._returncode = exit_code
            await asyncio.gather(self._stdout_task, self._stderr_task, return_exceptions=True)
            if not self._exit_future.done():
                self._exit_future.set_result(exit_code)


class BoxliteKaos:
    """
    KAOS backend for an existing BoxLite box.

    Box lifecycle is managed externally; this class never creates or stops boxes.
    """

    name: str = "boxlite"

    def __init__(
        self,
        box: boxlite.Box,
        *,
        home_dir: str = "/root",
        cwd: str | None = None,
    ) -> None:
        self._box = box
        self._home_dir = posixpath.normpath(home_dir)
        self._cwd = posixpath.normpath(cwd) if cwd is not None else self._home_dir

    def pathclass(self) -> type[PurePosixPath]:
        return PurePosixPath

    def normpath(self, path: StrOrKaosPath) -> KaosPath:
        return KaosPath(posixpath.normpath(str(path)))

    def gethome(self) -> KaosPath:
        return KaosPath(self._home_dir)

    def getcwd(self) -> KaosPath:
        return KaosPath(self._cwd)

    async def chdir(self, path: StrOrKaosPath) -> None:
        abs_path = self._abs_path(path)
        payload = await self._python_json(
            """
import json
import os
import sys

path = sys.argv[1]
if not os.path.exists(path):
    print(json.dumps({"ok": False, "error": "not_found"}))
elif not os.path.isdir(path):
    print(json.dumps({"ok": False, "error": "not_dir"}))
else:
    print(json.dumps({"ok": True}))
""",
            [abs_path],
        )
        if not payload.get("ok"):
            self._raise_path_error(payload, abs_path)
        self._cwd = abs_path

    async def stat(self, path: StrOrKaosPath, *, follow_symlinks: bool = True) -> StatResult:
        if not follow_symlinks:
            raise NotImplementedError("BoxliteKaos.stat does not support follow_symlinks=False")
        abs_path = self._abs_path(path)
        payload = await self._python_json(
            """
import json
import os
import sys

path = sys.argv[1]
try:
    st = os.stat(path)
    data = {
        "st_mode": st.st_mode,
        "st_ino": st.st_ino,
        "st_dev": st.st_dev,
        "st_nlink": st.st_nlink,
        "st_uid": st.st_uid,
        "st_gid": st.st_gid,
        "st_size": st.st_size,
        "st_atime": st.st_atime,
        "st_mtime": st.st_mtime,
        "st_ctime": st.st_ctime,
    }
    print(json.dumps({"ok": True, "data": data}))
except FileNotFoundError:
    print(json.dumps({"ok": False, "error": "not_found"}))
""",
            [abs_path],
        )
        if not payload.get("ok"):
            self._raise_path_error(payload, abs_path)
        data = payload["data"]
        return StatResult(
            st_mode=int(data["st_mode"]),
            st_ino=int(data["st_ino"]),
            st_dev=int(data["st_dev"]),
            st_nlink=int(data["st_nlink"]),
            st_uid=int(data["st_uid"]),
            st_gid=int(data["st_gid"]),
            st_size=int(data["st_size"]),
            st_atime=float(data["st_atime"]),
            st_mtime=float(data["st_mtime"]),
            st_ctime=float(data["st_ctime"]),
        )

    async def iterdir(self, path: StrOrKaosPath) -> AsyncGenerator[KaosPath]:
        abs_path = self._abs_path(path)
        payload = await self._python_json(
            """
import json
import os
import sys

path = sys.argv[1]
if not os.path.exists(path):
    print(json.dumps({"ok": False, "error": "not_found"}))
elif not os.path.isdir(path):
    print(json.dumps({"ok": False, "error": "not_dir"}))
else:
    entries = [os.path.join(path, entry) for entry in os.listdir(path)]
    print(json.dumps({"ok": True, "entries": entries}))
""",
            [abs_path],
        )
        if not payload.get("ok"):
            self._raise_path_error(payload, abs_path)
        for entry in payload["entries"]:
            yield KaosPath(entry)

    async def glob(
        self, path: StrOrKaosPath, pattern: str, *, case_sensitive: bool = True
    ) -> AsyncGenerator[KaosPath]:
        if not case_sensitive:
            raise ValueError("Case insensitive glob is not supported in current environment")
        abs_path = self._abs_path(path)
        payload = await self._python_json(
            """
import json
import os
import sys
from fnmatch import fnmatchcase

path = sys.argv[1]
pattern = sys.argv[2]
if not os.path.exists(path):
    print(json.dumps({"ok": False, "error": "not_found"}))
elif not os.path.isdir(path):
    print(json.dumps({"ok": False, "error": "not_dir"}))
else:
    entries = []
    for entry in os.listdir(path):
        if fnmatchcase(entry, pattern):
            entries.append(os.path.join(path, entry))
    print(json.dumps({"ok": True, "entries": entries}))
""",
            [abs_path, pattern],
        )
        if not payload.get("ok"):
            self._raise_path_error(payload, abs_path)
        for entry in payload["entries"]:
            yield KaosPath(entry)

    async def readbytes(self, path: StrOrKaosPath, n: int | None = None) -> bytes:
        abs_path = self._abs_path(path)
        payload = await self._python_json(
            """
import base64
import json
import sys

path = sys.argv[1]
try:
    with open(path, "rb") as f:
        data = f.read()
    print(json.dumps({"ok": True, "data": base64.b64encode(data).decode("ascii")}))
except FileNotFoundError:
    print(json.dumps({"ok": False, "error": "not_found"}))
""",
            [abs_path],
        )
        if not payload.get("ok"):
            self._raise_path_error(payload, abs_path)
        raw = base64.b64decode(payload["data"])
        return raw if n is None else raw[:n]

    async def readtext(
        self,
        path: StrOrKaosPath,
        *,
        encoding: str = "utf-8",
        errors: Literal["strict", "ignore", "replace"] = "strict",
    ) -> str:
        payload = await self.readbytes(path)
        return payload.decode(encoding, errors=errors)

    async def readlines(
        self,
        path: StrOrKaosPath,
        *,
        encoding: str = "utf-8",
        errors: Literal["strict", "ignore", "replace"] = "strict",
    ) -> AsyncGenerator[str]:
        text = await self.readtext(path, encoding=encoding, errors=errors)
        for line in text.splitlines(keepends=True):
            yield line

    async def writebytes(self, path: StrOrKaosPath, data: bytes) -> int:
        abs_path = self._abs_path(path)
        payload = base64.b64encode(data)
        await self._python_write(abs_path, payload, append=False)
        return len(data)

    async def writetext(
        self,
        path: StrOrKaosPath,
        data: str,
        *,
        mode: Literal["w", "a"] = "w",
        encoding: str = "utf-8",
        errors: Literal["strict", "ignore", "replace"] = "strict",
    ) -> int:
        payload = data.encode(encoding, errors=errors)
        await self._python_write(
            self._abs_path(path),
            base64.b64encode(payload),
            append=(mode == "a"),
        )
        return len(data)

    async def mkdir(
        self, path: StrOrKaosPath, parents: bool = False, exist_ok: bool = False
    ) -> None:
        abs_path = self._abs_path(path)
        payload = await self._python_json(
            """
import json
import os
import sys

path = sys.argv[1]
parents = sys.argv[2] == "1"
exist_ok = sys.argv[3] == "1"
if os.path.exists(path):
    if not exist_ok:
        print(json.dumps({"ok": False, "error": "exists"}))
    elif not os.path.isdir(path):
        print(json.dumps({"ok": False, "error": "exists_not_dir"}))
    else:
        print(json.dumps({"ok": True}))
else:
    if not parents:
        parent = os.path.dirname(path) or "/"
        if not os.path.exists(parent):
            print(json.dumps({"ok": False, "error": "parent_missing"}))
        elif not os.path.isdir(parent):
            print(json.dumps({"ok": False, "error": "parent_not_dir"}))
        else:
            os.mkdir(path)
            print(json.dumps({"ok": True}))
    else:
        os.makedirs(path, exist_ok=exist_ok)
        print(json.dumps({"ok": True}))
""",
            [abs_path, "1" if parents else "0", "1" if exist_ok else "0"],
        )
        if not payload.get("ok"):
            error = payload.get("error")
            if error in {"exists", "exists_not_dir"}:
                raise FileExistsError(f"{abs_path} already exists")
            if error == "parent_missing":
                raise FileNotFoundError(
                    f"Parent directory {posixpath.dirname(abs_path)} does not exist"
                )
            if error == "parent_not_dir":
                raise NotADirectoryError(
                    f"Parent path {posixpath.dirname(abs_path)} is not a directory"
                )
            raise RuntimeError(f"Failed to create directory {abs_path}")

    async def exec(self, *args: str) -> KaosProcess:
        if not args:
            raise ValueError("At least one argument (the program to execute) is required.")
        command = " ".join(shlex.quote(arg) for arg in args)
        if self._cwd:
            command = f"cd {shlex.quote(self._cwd)} && {command}"
        execution = await self._box.exec("sh", ["-c", command])
        return _BoxliteProcess(execution)

    async def _exec_capture(
        self, command: str, args: list[str], *, stdin: bytes | None = None
    ) -> tuple[bytes, bytes, int]:
        execution = await self._box.exec(command, args)
        if stdin is not None:
            writer = execution.stdin()
            writer.send_input(stdin)
            writer.close()

        stdout_task = asyncio.create_task(self._collect_stream(execution.stdout()))
        stderr_task = asyncio.create_task(self._collect_stream(execution.stderr()))
        result = await execution.wait()
        stdout, stderr = await asyncio.gather(stdout_task, stderr_task)
        return stdout, stderr, result.exit_code

    async def _collect_stream(self, stream: AsyncGenerator[bytes]) -> bytes:
        data = bytearray()
        async for chunk in stream:
            if isinstance(chunk, (bytes, bytearray)):
                data.extend(chunk)
            else:
                data.extend(str(chunk).encode("utf-8", "replace"))
        return bytes(data)

    async def _python_json(self, code: str, args: list[str]) -> dict[str, object]:
        stdout, stderr, exit_code = await self._exec_capture("python", ["-c", code, *args])
        if exit_code != 0:
            message = stderr.decode("utf-8", "replace").strip()
            raise RuntimeError(message or "BoxliteKaos python helper failed")
        try:
            return json.loads(stdout.decode("utf-8"))
        except json.JSONDecodeError as exc:
            raise RuntimeError(f"Invalid JSON response: {stdout!r}") from exc

    async def _python_write(self, path: str, payload: bytes, *, append: bool) -> None:
        code = """
import base64
import sys

path = sys.argv[1]
mode = "ab" if sys.argv[2] == "1" else "wb"
data = base64.b64decode(sys.stdin.buffer.read())
with open(path, mode) as f:
    f.write(data)
"""
        _, stderr, exit_code = await self._exec_capture(
            "python",
            ["-c", code, path, "1" if append else "0"],
            stdin=payload,
        )
        if exit_code != 0:
            message = stderr.decode("utf-8", "replace").strip()
            raise RuntimeError(message or f"Failed to write {path}")

    def _abs_path(self, path: StrOrKaosPath) -> str:
        raw = str(path)
        if posixpath.isabs(raw):
            return posixpath.normpath(raw)
        return posixpath.normpath(posixpath.join(self._cwd, raw))

    @staticmethod
    def _raise_path_error(payload: dict[str, object], path: str) -> None:
        error = payload.get("error")
        if error == "not_found":
            raise FileNotFoundError(path)
        if error == "not_dir":
            raise NotADirectoryError(f"{path} is not a directory")
        if error == "exists":
            raise FileExistsError(f"{path} already exists")
        raise RuntimeError(f"BoxliteKaos operation failed for {path}")
