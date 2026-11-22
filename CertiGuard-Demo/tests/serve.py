"""Static file server used for the automated tests (same files as python3 -m http.server, larger connection backlog
so that the 20-concurrent-user test measures the application, not the listen queue). Usage: python3 tests/serve.py 8765"""
import http.server, sys, functools, os
class S(http.server.ThreadingHTTPServer): request_queue_size = 256; daemon_threads = True
h = functools.partial(http.server.SimpleHTTPRequestHandler, directory=os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
h.func.log_message = lambda *a: None
S(("", int(sys.argv[1]) if len(sys.argv) > 1 else 8080), h).serve_forever()
