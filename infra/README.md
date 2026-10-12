# infra

| Folder       | Holds                                                     | Phase |
| ------------ | --------------------------------------------------------- | ----- |
| `docker/`    | Compose overrides and shared images (the API's own Dockerfile lives in `apps/api`) | 0 |
| `helm/`      | One chart per deployable app (`api`, `worker`)            | 4     |
| `terraform/` | Cloud resources per environment (`envs/staging`, `envs/production`) | 4 |

Local development only needs the root `docker-compose.yml`.
