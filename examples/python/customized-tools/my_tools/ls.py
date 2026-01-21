from kimi_agent_sdk import CallableTool2, ToolError, ToolOk, ToolReturnValue
from pydantic import BaseModel, Field


class Params(BaseModel):
    directory: str = Field(
        default=".",
        description="The directory to list files from.",
    )


class Ls(CallableTool2):
    name: str = "Ls"
    description: str = "List files in a directory."
    params: type[Params] = Params

    async def __call__(self, params: Params) -> ToolReturnValue:
        import os

        try:
            files = os.listdir(params.directory)
            output = "\n".join(files)
            return ToolOk(output=output)
        except Exception as exc:
            return ToolError(
                output="",
                message=str(exc),
                brief="Failed to list files",
            )
