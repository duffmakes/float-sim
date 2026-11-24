#!/usr/bin/env python3
"""Serves Float Sim on this computer and, where Capytaine is installed, runs "Solve with Capytaine" for the page.

    python3 tools/serve.py [--port 8765] [--bind 127.0.0.1]

Standard library only; Capytaine (pip install capytaine) is needed only for the solver, in this same Python.
API, same origin as the page; every request must carry the header X-Float-Sim: 1 (a page on another site cannot send
it without a CORS preflight, which this server does not answer):
  GET  /api/capytaine/status            {available, version, python, cores, memory, reason}
  POST /api/capytaine/solve             body: the case (tools/capytaine_solve.py) → {id, workers, panels, lidPanels}
  GET  /api/capytaine/jobs/<id>         {state, done, total, workers, elapsed, error, result}
  POST /api/capytaine/jobs/<id>/cancel  {state}
One solve runs at a time; a new one cancels the one before. Workers are separate processes, one frequency each, as
many as the cores and the free memory allow.
"""
import argparse, functools, http.server, importlib.metadata, importlib.util, json, math, multiprocessing as mp, os, sys
import threading, time, uuid

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
MAX_BODY = 64 * 1024 * 1024


def capytaine_status():
    if importlib.util.find_spec('capytaine') is None:
        return {'available': False, 'reason': f'Capytaine is not installed in this Python ({sys.executable}). Install it with "pip install capytaine" and start Float Sim with ./serve.sh again.'}
    try:
        version = importlib.metadata.version('capytaine')
    except importlib.metadata.PackageNotFoundError:
        version = '?'
    return {'available': True, 'version': version}


def mem_available():
    """bytes of memory free for new processes"""
    try:
        with open('/proc/meminfo') as f:
            for line in f:
                if line.startswith('MemAvailable:'):
                    return int(line.split()[1]) * 1024
    except OSError:
        pass
    try:
        return os.sysconf('SC_PAGE_SIZE') * os.sysconf('SC_AVPHYS_PAGES')
    except (ValueError, OSError, AttributeError):
        return 4e9


# ---------------------------------------------------------------- jobs
class Job:
    def __init__(self, case):
        import capytaine_solve as CS
        self.id = uuid.uuid4().hex[:12]
        self.case = case
        self.omegas = [float(w) for w in case['omegas']]
        self.total = len(self.omegas)
        self.done = 0
        self.state = 'starting'
        self.error = None
        self.out = {}
        self.pool = None
        self.cancelled = False
        self.t0 = time.time()
        cores = os.cpu_count() or 4
        per = CS.bytes_per_worker(case)
        self.workers = max(1, min(cores, self.total, int(0.6 * mem_available() // per)))
        self.threads = max(1, cores // self.workers)
        self.panels, self.lid_panels, _ = CS.panel_counts(case)
        threading.Thread(target=self.run, daemon=True).start()

    def run(self):
        import capytaine_solve as CS
        try:
            CS.build_body(self.case)            # a bad mesh fails here, with its message, before any worker starts
            for k in ('OMP_NUM_THREADS', 'OPENBLAS_NUM_THREADS', 'MKL_NUM_THREADS'):
                os.environ[k] = str(self.threads)
            if self.cancelled:
                return
            self.pool = mp.get_context('spawn').Pool(self.workers, initializer=CS.init_worker, initargs=(self.case,))
            if self.cancelled:                   # cancelled while the processes were starting
                return
            self.state = 'running'
            # highest frequencies first: they cost the most, so the workers stay balanced to the end
            order = sorted(range(self.total), key=lambda k: -self.omegas[k])
            for k, A, B, X in self.pool.imap_unordered(CS.solve_frequency, [(k, self.omegas[k]) for k in order]):
                if self.cancelled:
                    return
                self.out[k] = (A, B, X)
                self.done += 1
            self.pool.close()
            self.pool.join()
            if not self.cancelled:
                self.state = 'done'
        except Exception as e:                   # noqa: BLE001 — reported to the page
            if not self.cancelled:
                self.state, self.error = 'error', f'{type(e).__name__}: {e}'
        finally:
            if self.pool is not None and self.state != 'done':
                self.pool.terminate()

    def cancel(self):
        self.cancelled = True
        self.state = 'cancelled'
        if self.pool is not None:
            self.pool.terminate()

    def report(self):
        r = {'id': self.id, 'state': self.state, 'done': self.done, 'total': self.total, 'workers': self.workers,
             'threads': self.threads, 'elapsed': time.time() - self.t0, 'error': self.error}
        if self.state == 'done':
            ks = range(self.total)
            r['result'] = {'omegas': self.omegas, 'headings': self.case['headings'],
                           'A': [self.out[k][0] for k in ks], 'B': [self.out[k][1] for k in ks], 'X': [self.out[k][2] for k in ks]}
        return r


JOBS = {}
LOCK = threading.Lock()


# ---------------------------------------------------------------- HTTP
class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.json': 'application/json'}

    def log_message(self, fmt, *args):   # quiet: only errors and API calls
        if '/api/' in self.path or (len(args) > 1 and str(args[1]).startswith(('4', '5'))):
            super().log_message(fmt, *args)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    def _json(self, code, obj):
        body = json.dumps(obj, separators=(',', ':')).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _api_ok(self):
        host = (self.headers.get('Host') or '').rsplit(':', 1)[0].strip('[]')
        if host not in ('localhost', '127.0.0.1', '::1'):
            self._json(403, {'error': 'Float Sim answers only on localhost.'}); return False
        if self.headers.get('X-Float-Sim') != '1':
            self._json(403, {'error': 'Missing X-Float-Sim header.'}); return False
        return True

    def do_GET(self):
        if not self.path.startswith('/api/'):
            return super().do_GET()
        if not self._api_ok():
            return
        parts = self.path.split('?')[0].strip('/').split('/')
        if parts == ['api', 'capytaine', 'status']:
            st = capytaine_status()
            st.update(python=sys.executable, cores=os.cpu_count() or 1, memory=mem_available())
            return self._json(200, st)
        if len(parts) == 4 and parts[:3] == ['api', 'capytaine', 'jobs']:
            job = JOBS.get(parts[3])
            return self._json(200, job.report()) if job else self._json(404, {'error': 'No such job.'})
        self._json(404, {'error': 'Unknown API path.'})

    def do_POST(self):
        if not self.path.startswith('/api/'):
            return self._json(404, {'error': 'Unknown API path.'})
        if not self._api_ok():
            return
        parts = self.path.split('?')[0].strip('/').split('/')
        n = int(self.headers.get('Content-Length') or 0)
        if n > MAX_BODY:
            return self._json(413, {'error': 'Case too large.'})
        raw = self.rfile.read(n) if n else b''
        if parts == ['api', 'capytaine', 'solve']:
            st = capytaine_status()
            if not st['available']:
                return self._json(409, {'error': st['reason']})
            try:
                case = json.loads(raw)
                for key in ('bodyQ', 'sym', 'ref', 'omegas', 'headings', 'rho', 'g'):
                    if key not in case:
                        raise ValueError(f'missing {key}')
                if len(case['bodyQ']) % 9 or not case['omegas'] or any(not (w > 0 and math.isfinite(w)) for w in case['omegas']):
                    raise ValueError('bad mesh or frequencies')
            except (ValueError, TypeError, KeyError) as e:
                return self._json(400, {'error': f'Bad case: {e}'})
            with LOCK:
                for old in list(JOBS.values()):
                    if old.state in ('starting', 'running'):
                        old.cancel()
                    if time.time() - old.t0 > 3600:
                        JOBS.pop(old.id, None)
                job = Job(case)
                JOBS[job.id] = job
            return self._json(200, {'id': job.id, 'workers': job.workers, 'threads': job.threads,
                                    'panels': job.panels, 'lidPanels': job.lid_panels})
        if len(parts) == 5 and parts[:3] == ['api', 'capytaine', 'jobs'] and parts[4] == 'cancel':
            job = JOBS.get(parts[3])
            if not job:
                return self._json(404, {'error': 'No such job.'})
            job.cancel()
            return self._json(200, {'state': job.state})
        self._json(404, {'error': 'Unknown API path.'})


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--port', type=int, default=8765)
    ap.add_argument('--bind', default='127.0.0.1')
    a = ap.parse_args()
    st = capytaine_status()
    print(f'Float Sim → http://localhost:{a.port}', flush=True)
    print(f'Solve with Capytaine: {"on, Capytaine " + st["version"] if st["available"] else "off. " + st["reason"]}', flush=True)
    srv = http.server.ThreadingHTTPServer((a.bind, a.port), functools.partial(Handler, directory=ROOT))
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        for job in JOBS.values():
            job.cancel()


if __name__ == '__main__':
    main()
