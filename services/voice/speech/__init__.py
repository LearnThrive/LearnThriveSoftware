"""The speech engines behind LearnThrive AI's voice mode.

`speech.select.build_speech` reads the environment and returns a `SpeechService` holding one recogniser and one synthesiser. The HTTP
shell in `server.py` (and `bench.py`) never imports an engine directly, so which model is loaded is a configuration question and the
health output can always tell the truth about it.
"""
from .select import SpeechService, build_speech

__all__ = ["SpeechService", "build_speech"]
