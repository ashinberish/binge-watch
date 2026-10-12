# Shortcuts for macOS/Linux. Every target calls a root package.json script,
# so Windows users run the same thing with `pnpm <script>` (see README).
.PHONY: setup up down migrate seed dev worker storybook lint typecheck test check gen

setup:     ; pnpm run bootstrap
up:        ; pnpm run services:up
down:      ; pnpm run services:down
migrate:   ; pnpm run migrate
seed:      ; pnpm run seed
dev:       ; pnpm run dev
worker:    ; pnpm run worker
storybook: ; pnpm run storybook
lint:      ; pnpm run lint
typecheck: ; pnpm run typecheck
test:      ; pnpm run test
check:     ; pnpm run check
gen:       ; pnpm run gen
