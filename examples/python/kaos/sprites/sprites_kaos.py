from __future__ import annotations

import asyncio
import json
import posixpath
import queue
import stat
import threading
from collections.abc import AsyncGenerator, Iterable
from pathlib import PurePosixPath
from typing import TYPE_CHECKING, Literal

from kaos import AsyncReadable, AsyncWritable, Kaos, KaosProcess, StatResult, StrOrKaosPath
from kaos.path import KaosPath
from sprites import Sprite
from sprites.exceptions import (
    DirectoryNotEmptyError,
    ExecError,
    FileNotFoundError_,
    FilesystemError,
    IsADirectoryError_,
    NotADirectoryError_,
    PermissionError_,
    TimeoutError,
)
from sprites.filesystem import SpriteFilesystem, SpritePath
from sprites.session import kill_session

if TYPE_CHECKING:

    def type_check(sprites_kaos: SpritesKaos) -> None:
        _: Kaos = sprites_kaos


class _SpritesCommandInput:
    def __init__(self) -> None:
        self._queue: queue.Queue[bytes | None] = queue.Queue()
        self._buffer = bytearray()
        self._closed = False
        self._eof_sent = False
        self._lock = threading.Lock()

    def write(self, data: bytes) -> None:
        if not data:
            return
        with self._lock:
            if self._closed:
                return
        self._queue.put(bytes(data))

    def writelines(self, data: Iterable[bytes], /) -> None:
        for chunk in data:
            self.write(chunk)

    def close(self) -> None:
        with self._lock:
            if self._eof_sent:
                self._closed = True
                return
            self._closed = True
            self._eof_sent = True
        self._queue.put(None)

    def write_eof(self) -> None:
        self.close()

    def is_closing(self) -> bool:
        with self._lock:
            return self._closed

    def read(self, n: int = -1) -> bytes:
        if n == 0:
            return b""

        while not self._buffer:
            item = self._queue.get()
            if item is None:
                return b""
            self._buffer.extend(item)

        if n < 0:
            payload = bytes(self._buffer)
            self._buffer.clear()
            return payload

        payload = bytes(self._buffer[:n])
        del self._buffer[:n]
        return payload


class _SpritesStdin:
    def __init__(self, source: _SpritesCommandInput) -> None:
        self._source = source

    def can_write_eof(self) -> bool:
        return True

    def close(self) -> None:
        self._source.close()

    async def drain(self) -> None:
        return None

    def is_closing(self) -> bool:
        return self._source.is_closing()

    async def wait_closed(self) -> None:
        return None

    def write(self, data: bytes) -> None:
        self._source.write(data)

    def writelines(self, data: Iterable[bytes], /) -> None:
        self._source.writelines(data)

    def write_eof(self) -> None:
        self._source.write_eof()


class _StreamWriterProxy:
    def __init__(self, loop: asyncio.AbstractEventLoop, reader: asyncio.StreamReader) -> None:
        self._loop = loop
        self._reader = reader
        self._closed = False
        self._lock = threading.Lock()

    def write(self, data: bytes | bytearray) -> int:
        payload = bytes(data)
        if not payload:
            return 0
        with self._lock:
            if self._closed:
                return 0
        self._loop.call_soon_threadsafe(self._reader.feed_data, payload)
        return len(payload)

    def flush(self) -> None:
        return None

    def close(self) -> None:
        with self._lock:
            if self._closed:
                return
            self._closed = True
        self._loop.call_soon_threadsafe(self._reader.feed_eof)


class _SpritesProcess:
    def __init__(self, sprite: Sprite, args: tuple[str, ...], cwd: str) -> None:
        self._sprite = sprite
        self._args = args
        self._cwd = cwd
        self._stdin_source = _SpritesCommandInput()
        self._stdout_reader = asyncio.StreamReader()
        self._stderr_reader = asyncio.StreamReader()
        loop = asyncio.get_running_loop()
        self._stdout_proxy = _StreamWriterProxy(loop, self._stdout_reader)
        self._stderr_proxy = _StreamWriterProxy(loop, self._stderr_reader)
        self.stdin: AsyncWritable = _SpritesStdin(self._stdin_source)
        self.stdout: AsyncReadable = self._stdout_reader
        self.stderr: AsyncReadable = self._stderr_reader
        self._returncode: int | None = None
        self._exit_future: asyncio.Future[int] = loop.create_future()
        self._session_id: str | None = None
        self._session_id_ready = threading.Event()
        self._runner_task = asyncio.create_task(self._run())

    @property
    def pid(self) -> int:
        return -1

    @property
    def returncode(self) -> int | None:
        return self._returncode

    async def wait(self) -> int:
        return await self._exit_future

    async def kill(self) -> None:
        if self._returncode is not None:
            return
        self._stdin_source.write_eof()
        await asyncio.to_thread(self._session_id_ready.wait, 1.0)
        if self._session_id is None:
            return
        await asyncio.to_thread(kill_session, self._sprite, self._session_id)

    def _on_text_message(self, message: bytes) -> None:
        try:
            payload: object = json.loads(message.decode("utf-8", errors="replace"))
        except json.JSONDecodeError:
            return
        if not isinstance(payload, dict):
            return
        if payload.get("type") != "session_info":
            return

        session_id_obj: object | None = payload.get("id")
        if isinstance(session_id_obj, str):
            self._session_id = session_id_obj
            self._session_id_ready.set()
            return

        data_obj: object | None = payload.get("data")
        if isinstance(data_obj, dict):
            nested_session_id: object | None = data_obj.get("id")
            if isinstance(nested_session_id, str):
                self._session_id = nested_session_id
                self._session_id_ready.set()

    def _run_sync(self) -> int:
        command = self._sprite.command(*self._args, cwd=self._cwd)
        command.stdin = self._stdin_source
        command.stdout = self._stdout_proxy
        command.stderr = self._stderr_proxy
        command._text_message_handler = self._on_text_message
        try:
            command.run()
        except ExecError:
            exit_code = command.exit_code
            return exit_code if exit_code >= 0 else 1
        except TimeoutError as exc:
            self._stderr_proxy.write(f"[sprites timeout] {exc}\n".encode("utf-8", "replace"))
            return 124
        except Exception as exc:
            self._stderr_proxy.write(f"[sprites command error] {exc}\n".encode("utf-8", "replace"))
            return 1
        exit_code = command.exit_code
        return exit_code if exit_code >= 0 else 1

    async def _run(self) -> None:
        exit_code = await asyncio.to_thread(self._run_sync)
        self._returncode = exit_code
        self._stdout_proxy.close()
        self._stderr_proxy.close()
        if not self._exit_future.done():
            self._exit_future.set_result(exit_code)


class SpritesKaos:
    """
    KAOS backend for an existing Sprites sprite.

    Sprite lifecycle is managed externally; this class never creates or deletes sprites.
    """

    name: str = "sprites"

    def __init__(
        self,
        sprite: Sprite,
        *,
        home_dir: str = "/home/sprite",
        cwd: str | None = None,
    ) -> None:
        self._sprite = sprite
        self._home_dir = posixpath.normpath(home_dir)
        self._cwd = posixpath.normpath(cwd) if cwd is not None else self._home_dir
        self._filesystem: SpriteFilesystem = sprite.filesystem("/")

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
        target = self._fs_path(abs_path)
        try:
            info = await asyncio.to_thread(target.stat)
        except FilesystemError as exc:
            self._raise_filesystem_error(exc, abs_path)
        if not info.is_dir:
            raise NotADirectoryError(f"{abs_path} is not a directory")
        self._cwd = abs_path

    async def stat(self, path: StrOrKaosPath, *, follow_symlinks: bool = True) -> StatResult:
        if not follow_symlinks:
            raise NotImplementedError("SpritesKaos.stat does not support follow_symlinks=False")
        abs_path = self._abs_path(path)
        target = self._fs_path(abs_path)
        try:
            info = await asyncio.to_thread(target.stat)
        except FilesystemError as exc:
            self._raise_filesystem_error(exc, abs_path)

        mode = self._with_type_bits(info.mode, info.is_dir)
        mtime = info.mod_time.timestamp()
        return StatResult(
            st_mode=mode,
            st_ino=0,
            st_dev=0,
            st_nlink=1,
            st_uid=0,
            st_gid=0,
            st_size=info.size,
            st_atime=mtime,
            st_mtime=mtime,
            st_ctime=mtime,
        )

    async def iterdir(self, path: StrOrKaosPath) -> AsyncGenerator[KaosPath]:
        abs_path = self._abs_path(path)
        target = self._fs_path(abs_path)
        try:
            entries = await asyncio.to_thread(lambda: [str(entry) for entry in target.iterdir()])
        except FilesystemError as exc:
            self._raise_filesystem_error(exc, abs_path)
        for entry in entries:
            yield KaosPath(entry)

    async def glob(
        self, path: StrOrKaosPath, pattern: str, *, case_sensitive: bool = True
    ) -> AsyncGenerator[KaosPath]:
        if not case_sensitive:
            raise ValueError("Case insensitive glob is not supported in current environment")
        from fnmatch import fnmatchcase

        abs_path = self._abs_path(path)
        target = self._fs_path(abs_path)
        try:
            entries = await asyncio.to_thread(lambda: [str(entry) for entry in target.iterdir()])
        except FilesystemError as exc:
            self._raise_filesystem_error(exc, abs_path)
        for entry in entries:
            if fnmatchcase(posixpath.basename(entry), pattern):
                yield KaosPath(entry)

    async def readbytes(self, path: StrOrKaosPath, n: int | None = None) -> bytes:
        abs_path = self._abs_path(path)
        target = self._fs_path(abs_path)
        try:
            payload = await asyncio.to_thread(target.read_bytes)
        except FilesystemError as exc:
            self._raise_filesystem_error(exc, abs_path)
        return payload if n is None else payload[:n]

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
        target = self._fs_path(abs_path)
        try:
            await asyncio.to_thread(target.write_bytes, data)
        except FilesystemError as exc:
            self._raise_filesystem_error(exc, abs_path)
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
        abs_path = self._abs_path(path)
        target = self._fs_path(abs_path)
        payload = data.encode(encoding, errors=errors)

        try:
            if mode == "a":
                existing = b""
                try:
                    existing = await asyncio.to_thread(target.read_bytes)
                except FileNotFoundError_:
                    existing = b""
                await asyncio.to_thread(target.write_bytes, existing + payload)
            else:
                await asyncio.to_thread(target.write_bytes, payload)
        except FilesystemError as exc:
            self._raise_filesystem_error(exc, abs_path)
        return len(data)

    async def mkdir(
        self, path: StrOrKaosPath, parents: bool = False, exist_ok: bool = False
    ) -> None:
        abs_path = self._abs_path(path)
        target = self._fs_path(abs_path)

        try:
            info = await asyncio.to_thread(target.stat)
            if not info.is_dir:
                raise FileExistsError(f"{abs_path} already exists and is not a directory")
            if not exist_ok:
                raise FileExistsError(f"{abs_path} already exists")
            return
        except FileNotFoundError_:
            pass
        except FilesystemError as exc:
            self._raise_filesystem_error(exc, abs_path)

        if not parents:
            parent_path = posixpath.dirname(abs_path) or "/"
            parent = self._fs_path(parent_path)
            try:
                parent_info = await asyncio.to_thread(parent.stat)
            except FilesystemError as exc:
                self._raise_filesystem_error(exc, parent_path)
            if not parent_info.is_dir:
                raise NotADirectoryError(f"{parent_path} is not a directory")

        try:
            await asyncio.to_thread(target.mkdir, parents=parents, exist_ok=exist_ok)
        except FilesystemError as exc:
            self._raise_filesystem_error(exc, abs_path)

    async def exec(self, *args: str) -> KaosProcess:
        if not args:
            raise ValueError("At least one argument (the program to execute) is required.")
        process = _SpritesProcess(self._sprite, args, self._cwd)
        return process

    def _abs_path(self, path: StrOrKaosPath) -> str:
        raw = str(path)
        if posixpath.isabs(raw):
            return posixpath.normpath(raw)
        return posixpath.normpath(posixpath.join(self._cwd, raw))

    def _fs_path(self, abs_path: str) -> SpritePath:
        return self._filesystem / abs_path

    @staticmethod
    def _raise_filesystem_error(exc: FilesystemError, path: str) -> None:
        if isinstance(exc, FileNotFoundError_):
            raise FileNotFoundError(path) from exc
        if isinstance(exc, NotADirectoryError_):
            raise NotADirectoryError(path) from exc
        if isinstance(exc, IsADirectoryError_):
            raise IsADirectoryError(path) from exc
        if isinstance(exc, PermissionError_):
            raise PermissionError(path) from exc
        if isinstance(exc, DirectoryNotEmptyError):
            raise OSError(f"{path} is not empty") from exc
        raise RuntimeError(str(exc)) from exc

    @staticmethod
    def _with_type_bits(mode: str, is_dir: bool) -> int:
        mode_value = int(mode, 8)
        if stat.S_IFMT(mode_value) != 0:
            return mode_value
        type_mode = stat.S_IFDIR if is_dir else stat.S_IFREG
        return mode_value | type_mode
