"""Version 1 API: aggregates every module router."""

from fastapi import APIRouter

from app.modules.auth.router import router as auth_router
from app.modules.catalog.router import router as catalog_router
from app.modules.profiles.router import router as profiles_router
from app.modules.streaks.router import router as streaks_router
from app.modules.users.router import router as users_router
from app.modules.watch_history.router import router as watch_history_router

router = APIRouter()
router.include_router(auth_router)
router.include_router(users_router)
router.include_router(profiles_router)
router.include_router(catalog_router)
router.include_router(watch_history_router)
router.include_router(streaks_router)
