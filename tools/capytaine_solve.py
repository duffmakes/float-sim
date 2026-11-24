"""Float Sim's "Solve with Capytaine": Capytaine (Ancellin & Dias 2019) solves the radiation and diffraction problems
on the wetted-surface panels Float Sim made, in place of Float Sim's own panel method. Used by tools/serve.py.

The case comes from the page (js/capytaine.js), in the same form Float Sim's panel-method workers use (js/bemrun.js):
  bodyQ, lidQ  flat triangle soups, 9 numbers per triangle, in the seakeeping axes with the still waterline at z = 0
               and G on the z axis; normals out of the hull. With symmetry, only the part x ≥ x0 and/or y ≥ y0.
  sym          { x, y, x0, y0 }: mirror planes x = x0 and y = y0
  ref          rotation centre for the rotational modes, on the symmetry planes
  omegas, headings (deg), rho, g
Returned per frequency, as Float Sim's workers return them before their transfer to G: A, B (6 × 6, row = force,
column = motion, about ref) and X (per heading, 6 × [re, im], per metre of wave amplitude), in Float Sim's
convention: time dependence exp(+i w t) and the incident wave phase zero at x = y = 0. Capytaine uses exp(-i w t),
so X is conjugated. Its symmetric meshes need the planes through the origin, so the mesh is shifted by (-x0, -y0)
and X is shifted back to Float Sim's origin.
Deep water, the direct (potential) formulation, an irregular-frequency lid when the page sends one.
"""
import math

DOFS = ['Surge', 'Sway', 'Heave', 'Roll', 'Pitch', 'Yaw']


def _mesh(cpt, np, soup, sym):
    tri = np.asarray(soup, dtype=float).reshape(-1, 3, 3)
    tri[:, :, 0] -= sym['x0']
    tri[:, :, 1] -= sym['y0']
    verts = tri.reshape(-1, 3)
    faces = np.arange(len(verts)).reshape(-1, 3).tolist()
    m = cpt.Mesh(vertices=verts, faces=faces)
    if sym.get('y'):
        m = cpt.ReflectionSymmetricMesh(half=m, plane='xOz')    # mirror y → −y (about y = y0)
    if sym.get('x'):
        m = cpt.ReflectionSymmetricMesh(half=m, plane='yOz')    # mirror x → −x (about x = x0)
    return m


def build_body(case):
    import numpy as np
    import capytaine as cpt
    sym = case['sym']
    hull = _mesh(cpt, np, case['bodyQ'], sym)
    lid = _mesh(cpt, np, case['lidQ'], sym) if case.get('lidQ') else None
    rc = (case['ref'][0] - sym['x0'], case['ref'][1] - sym['y0'], case['ref'][2])
    return cpt.FloatingBody(mesh=hull, lid_mesh=lid, dofs=cpt.rigid_body_dofs(rotation_center=rc), center_of_mass=rc)


def panel_counts(case):
    mult = (2 if case['sym'].get('x') else 1) * (2 if case['sym'].get('y') else 1)
    nb = len(case['bodyQ']) // 9 * mult
    nl = len(case['lidQ']) // 9 * mult if case.get('lidQ') else 0
    return nb, nl, mult


def bytes_per_worker(case):
    """Direct method: two influence matrices and an LU factorisation (complex128); a symmetry plane halves them."""
    nb, nl, mult = panel_counts(case)
    n = nb + nl
    return 48 * n * n / mult + 3.0e8


# ---------------------------------------------------------------- worker process
_W = {}


def init_worker(case):
    # an exception here would make multiprocessing.Pool start replacement workers forever, so it is kept for
    # solve_frequency to raise, which ends the job with the message
    try:
        import capytaine as cpt
        cpt.set_logging('ERROR')
        _W.update(cpt=cpt, case=case, body=build_body(case), solver=cpt.BEMSolver(method='direct'))
    except Exception as e:      # noqa: BLE001
        _W['error'] = e


def solve_frequency(job):
    """job = (k, omega) → (k, A, B, X) in Float Sim's convention (see the module docstring)."""
    from capytaine.bem.airy_waves import froude_krylov_force
    k, w = job
    if 'error' in _W:
        raise RuntimeError(f'Capytaine could not start: {_W["error"]}')
    cpt, case, body = _W['cpt'], _W['case'], _W['body']
    rho, g, sym = case['rho'], case['g'], case['sym']
    rad = [cpt.RadiationProblem(body=body, radiating_dof=d, omega=w, rho=rho, g=g, water_depth=math.inf) for d in DOFS]
    dif = [cpt.DiffractionProblem(body=body, wave_direction=math.radians(b), omega=w, rho=rho, g=g, water_depth=math.inf) for b in case['headings']]
    res = _W['solver'].solve_all(rad + dif, progress_bar=False)
    A = [[0.0] * 6 for _ in range(6)]
    B = [[0.0] * 6 for _ in range(6)]
    for r in res[:6]:
        j = DOFS.index(r.problem.radiating_dof)
        for i, d in enumerate(DOFS):
            A[i][j] = float(r.added_mass[d])
            B[i][j] = float(r.radiation_damping[d])
    K = w * w / g
    X = []
    for r, b in zip(res[6:], case['headings']):
        fk = froude_krylov_force(r.problem)
        br = math.radians(b)
        # exp(-i w t) → exp(+i w t): conjugate; then the wave phase from the shifted origin back to Float Sim's
        ph = -K * (sym['x0'] * math.cos(br) + sym['y0'] * math.sin(br))
        c, s = math.cos(ph), math.sin(ph)
        row = []
        for d in DOFS:
            z = complex(r.forces[d] + fk[d]).conjugate()
            row.append([z.real * c - z.imag * s, z.real * s + z.imag * c])
        X.append(row)
    return k, A, B, X
