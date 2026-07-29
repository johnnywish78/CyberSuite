from fastapi.testclient import TestClient
from backend.app import app


client = TestClient(app)


def test_stats_websocket():

    with client.websocket_connect("/ws/stats") as ws:

        data = ws.receive_json()

        assert isinstance(data, dict)



def test_terminal_websocket():

    with client.websocket_connect("/ws/terminal") as ws:

        assert ws is not None
