"""Single source of the MongoDB client + `get_db` dependency.

Usage in any router:
    from database import get_db

    @router.get("/things")
    async def list_things(user=Depends(get_current_user), db=Depends(get_db)):
        return await db.things.find({"clinic_id": user["clinic_id"]}, {"_id": 0}).to_list(100)
"""
import os
from pathlib import Path

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase

# Ensure .env is loaded before we read MONGO_URL (server.py also calls load_dotenv,
# but `database.py` may be imported from routers that run first).
load_dotenv(Path(__file__).parent / '.env')

# Connection pool tuning for a 100+ concurrent-user launch — Motor's
# default `maxPoolSize=100` is fine but `minPoolSize=0` means every idle
# reconnect pays a 3-way TCP + auth handshake (~50-100ms) on the next
# request. Warm-priming with `minPoolSize=10` keeps a stable pool under
# load and shaves the "cold" tail off the p95.
client: AsyncIOMotorClient = AsyncIOMotorClient(
    os.environ['MONGO_URL'],
    maxPoolSize=100,
    minPoolSize=10,
    serverSelectionTimeoutMS=5000,
    waitQueueTimeoutMS=5000,
)
db: AsyncIOMotorDatabase = client[os.environ['DB_NAME']]


def get_db() -> AsyncIOMotorDatabase:
    """FastAPI dependency that returns the active Motor database handle."""
    return db
