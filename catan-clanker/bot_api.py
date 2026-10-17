from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from live_session import LiveGameSession

app = FastAPI()
sessions = {}
app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://colonist.io"],
    allow_methods=["POST", "OPTIONS"],
    allow_headers=["*"],
)


class EventRequest(BaseModel):
    game_id: str
    bot_color: int | None = None
    event: dict


@app.post("/api/bot/games/events")
def receive_event(request: EventRequest):
    event_type = request.event.get("data", {}).get("type")
    print(
        f"BOT_EVENT game={request.game_id} type={event_type} bot_color={request.bot_color}",
        flush=True,
    )
    session = sessions.get(request.game_id)

    if session is None:
        session = LiveGameSession(
            game_id=request.game_id,
            bot_color=request.bot_color,
        )
        sessions[request.game_id] = session

    try:
        result = session.process_event(request.event)
        print(f"BOT_RESULT {result}", flush=True)
        return result
    except Exception as error:
        raise HTTPException(status_code=400, detail=str(error))