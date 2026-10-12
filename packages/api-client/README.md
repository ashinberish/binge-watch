# @nightreel/api-client

Typed client for the Nightreel API, generated from FastAPI's OpenAPI schema.
Never edit `src/schema.d.ts` by hand.

```sh
make gen   # export openapi.json from apps/api, then regenerate src/schema.d.ts
```

CI runs the same steps and fails if the committed client has drifted from the API.
