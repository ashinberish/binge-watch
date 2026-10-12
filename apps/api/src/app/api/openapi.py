"""OpenAPI post-processing so the generated client sees accurate error media types."""

from typing import Any

from fastapi import FastAPI
from fastapi.openapi.utils import get_openapi

from app.core.exceptions import PROBLEM_JSON


def build_openapi(app: FastAPI) -> dict[str, Any]:
    if app.openapi_schema:
        return app.openapi_schema
    schema = get_openapi(
        title=app.title,
        version=app.version,
        description=app.description,
        routes=app.routes,
        tags=app.openapi_tags,
        separate_input_output_schemas=app.separate_input_output_schemas,
    )
    for path_item in schema.get("paths", {}).values():
        for operation in path_item.values():
            for code, response in operation.get("responses", {}).items():
                content = response.get("content")
                if (
                    code.isdigit()
                    and int(code) >= 400
                    and content
                    and "application/json" in content
                ):
                    content[PROBLEM_JSON] = content.pop("application/json")
    app.openapi_schema = schema
    return schema
