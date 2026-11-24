"""RAO comparison, Capytaine side: the same test models solved with Capytaine on its own, outside Float Sim.

    ~/venvs/bem/bin/python test/rao-compare/capytaine_rao.py [id ...] [--workers N]

Nothing here comes from Float Sim's meshes or solver. Each body is meshed analytically with Capytaine's own mesh
generators from its dimensions (test/make_models.py), floated at its exact draft for the given mass, and solved with
Capytaine's direct (potential) formulation with the irregular-frequency lid from Capytaine's generate_lid. (A lid
that covers the whole waterplane, its edge on the hull's waterline, gave wrong results on the flat-sided bodies here:
heave damping 40 % off the Haskind energy relation for the 4 × 2 m box at 0.5 Hz. generate_lid keeps a margin
from the hull and agrees with the relation, and with no lid away from the irregular frequencies.) The hydrostatic stiffness comes from
Capytaine's own hydrostatics, and the RAOs from capytaine.post_pro.rao. The inputs shared with Float Sim are the mass,
the CoG, the inertia about the CoG (the uniform-density tensor Float Sim computes, from results/props.json, as a CAD
mass-properties report would give it), the frequencies and the headings (cases.json).

Axes: x, y horizontal as in the CAD file (Float Sim's RAO axes), z up, waterline at z = 0, G on the z axis, so the
wave phase is measured at G as in Float Sim. Results are converted to Float Sim's convention exp(+i w t) (Capytaine
uses exp(-i w t), so complex values are conjugated). Writes results/capytaine/<id>.json.
"""
import json, math, os, sys, time
import multiprocessing as mp

HERE = os.path.dirname(os.path.abspath(__file__))
CFG = json.load(open(os.path.join(HERE, 'cases.json')))
DOFS = ['Surge', 'Sway', 'Heave', 'Roll', 'Pitch', 'Yaw']


# ---------------------------------------------------------------- geometry (dimensions from test/make_models.py)
def sphere_cap_depth(r, V):
    """depth h of the immersed cap of a sphere of radius r with volume V = πh²(3r − h)/3"""
    lo, hi = 0.0, 2 * r
    for _ in range(200):
        h = (lo + hi) / 2
        (lo, hi) = (h, hi) if math.pi * h * h * (3 * r - h) / 3 < V else (lo, h)
    return (lo + hi) / 2


def orient_outward(vertices, faces, inside):
    """flip faces of a convex body so their normals point away from an interior point"""
    import numpy as np
    out = []
    for f in faces:
        p = [np.array(vertices[i]) for i in f]
        n = np.cross(p[1] - p[0], p[2] - p[0])
        c = sum(p) / len(p)
        out.append(list(f) if np.dot(n, c - np.array(inside)) > 0 else list(reversed(f)))
    return out


def v_prism_mesh(cpt, L, T, a, nx, ns):
    """immersed part of a V-section prism along x (apex at z = −T, waterline half-width T tan a), quads + triangles"""
    w = T * math.tan(a)
    verts, faces = [], []

    def add(p):
        verts.append(p)
        return len(verts) - 1
    xs = [-L / 2 + L * i / nx for i in range(nx + 1)]
    for side in (1, -1):
        grid = [[add([x, side * w * j / ns, -T + T * j / ns]) for j in range(ns + 1)] for x in xs]
        for i in range(nx):
            for j in range(ns):
                faces.append([grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]])
    for x in (-L / 2, L / 2):        # end caps: triangle (apex, ±w at the waterline) on a triangular grid
        idx = {}
        for j in range(ns + 1):      # row j at height z = −T + T j / ns spans y = −w j/ns … w j/ns in j steps
            for k in range(j + 1):
                y = -w * j / ns + (2 * w * j / ns) * (k / j if j else 0)
                idx[(j, k)] = add([x, y, -T + T * j / ns])
        for j in range(ns):
            for k in range(j + 1):
                faces.append([idx[(j, k)], idx[(j + 1, k)], idx[(j + 1, k + 1)]])
                if k < j:
                    faces.append([idx[(j, k)], idx[(j + 1, k + 1)], idx[(j, k + 1)]])
    faces = orient_outward(verts, faces, [0, 0, -T / 3])
    return cpt.Mesh(vertices=verts, faces=faces, name='v_prism')


def build(cpt, cid, mass, rho):
    """(immersed hull, z of G relative to the waterline, description) in the RAO axes, G on the z axis"""
    V = mass / rho
    if cid in ('box_4x2x1', 'box_moved'):
        L, B, T = 4.0, 2.0, mass / (rho * 8.0)
        hull = cpt.mesh_parallelepiped(size=(L, B, 2 * T), center=(0, 0, 0), resolution=(32, 16, 6)).immersed_part()
        if cid == 'box_moved':        # the CAD file has the box turned +30° about z (make_models.py, case 8)
            hull = hull.rotated_z(math.radians(30))
        return hull, 0.5 - T, f'box {L} × {B} m, draft {T:.4f} m'
    if cid == 'buoy_cyl':
        a = 0.35; T = V / (math.pi * a * a)
        hull = cpt.mesh_vertical_cylinder(length=2 * T, radius=a, center=(0, 0, 0), resolution=(8, 48, 28)).immersed_part()
        return hull, 0.23 - T, f'vertical cylinder a {a} m, draft {T:.4f} m'
    if cid == 'cube_1m':
        T = V / 1.0
        hull = cpt.mesh_parallelepiped(size=(1, 1, 2 * T), center=(0, 0, 0), resolution=(14, 14, 24)).immersed_part()
        return hull, 0.5 - T, f'cube 1 m, draft {T:.4f} m'
    if cid == 'hcyl_log':            # half immersed: axis at the waterline
        r, L = 0.2, 3.0
        hull = cpt.mesh_horizontal_cylinder(length=L, radius=r, center=(0, 0, 0), resolution=(6, 40, 60)).immersed_part()
        return hull, 0.15 - r, f'horizontal cylinder r {r} m × {L} m, axis at the waterline'
    if cid in ('kramer_sphere', 'sphere_r1'):
        r = 0.15 if cid == 'kramer_sphere' else 1.0
        zc_file, zg_file = (0.15, 0.1152) if cid == 'kramer_sphere' else (1.0, 0.7)
        h = sphere_cap_depth(r, V)           # immersed depth; the centre is at z = r − h
        zc = r - h
        nt = 80 if r > 0.5 else 64
        hull = cpt.mesh_sphere(radius=r, center=(0, 0, zc), resolution=(nt // 2, nt)).immersed_part()
        return hull, zc + (zg_file - zc_file), f'sphere r {r} m, immersed depth {h:.5f} m'
    if cid == 'spar':
        a = 0.5; T = V / (math.pi * a * a)
        hull = cpt.mesh_vertical_cylinder(length=2 * T, radius=a, center=(0, 0, 0), resolution=(8, 40, 80)).immersed_part()
        return hull, 1.0 - T, f'vertical cylinder a {a} m, draft {T:.4f} m'
    if cid == 'square_log_3x1x1':    # s.g. ½ corner-down: the centre is on the waterline
        hull = cpt.mesh_parallelepiped(size=(3, 1, 1), center=(0, 0, 0), resolution=(36, 12, 12)).rotated_x(math.radians(45)).immersed_part()
        return hull, 0.0, 'square 1 × 1 m section rolled 45°, 3 m long, draft √2/2 m'
    if cid == 'v_prism':
        a, L = math.radians(30), 3.0
        T = math.sqrt(V / (L * math.tan(a)))
        hull = v_prism_mesh(cpt, L, T, a, 30, 7)
        return hull, 0.35 - T, f'V prism 30° half-angle, {L} m, draft {T:.4f} m'
    if cid in ('vcyl_squat', 'vcyl_tall'):
        a, res = (0.5, (10, 64, 8)) if cid == 'vcyl_squat' else (0.25, (6, 40, 20))
        T = V / (math.pi * a * a)
        hull = cpt.mesh_vertical_cylinder(length=2 * T, radius=a, center=(0, 0, 0), resolution=res).immersed_part()
        return hull, 0.2 - T, f'vertical cylinder a {a} m, draft {T:.4f} m'
    raise ValueError(cid)


# ---------------------------------------------------------------- worker: one frequency, all radiation and diffraction problems
_W = {}


def _init(cid, mass, IG, rho, g):
    import capytaine as cpt
    import numpy as np
    cpt.set_logging('ERROR')
    hull, zg, _ = build(cpt, cid, mass, rho)
    lid = hull.generate_lid(z=0.0)
    G = (0.0, 0.0, zg)
    body = cpt.FloatingBody(mesh=hull, lid_mesh=lid, dofs=cpt.rigid_body_dofs(rotation_center=G), center_of_mass=G, mass=mass)
    _W.update(cpt=cpt, body=body, solver=cpt.BEMSolver(method='direct'), rho=rho, g=g)


def _solve(w):
    cpt, body = _W['cpt'], _W['body']
    rho, g = _W['rho'], _W['g']
    pbs = [cpt.RadiationProblem(body=body, radiating_dof=d, omega=w, rho=rho, g=g, water_depth=math.inf) for d in DOFS]
    pbs += [cpt.DiffractionProblem(body=body, wave_direction=math.radians(b), omega=w, rho=rho, g=g, water_depth=math.inf) for b in CFG['headings']]
    res = _W['solver'].solve_all(pbs, progress_bar=False)
    return cpt.assemble_dataset(res, hydrostatics=False)


def mem_available():
    try:
        for line in open('/proc/meminfo'):
            if line.startswith('MemAvailable'):
                return int(line.split()[1]) * 1024
    except OSError:
        pass
    return 8e9


def run_case(c, props, workers):
    import numpy as np
    import xarray as xr
    import capytaine as cpt
    cpt.set_logging('ERROR')
    rho, g, cid = CFG['rho'], CFG['g'], c['id']
    IG = np.array(props[cid]['IG']).reshape(3, 3)
    hull, zg, desc = build(cpt, cid, c['mass'], rho)
    lid = hull.generate_lid(z=0.0)
    G = (0.0, 0.0, zg)
    body = cpt.FloatingBody(mesh=hull, lid_mesh=lid, dofs=cpt.rigid_body_dofs(rotation_center=G), center_of_mass=G, mass=c['mass'])
    C = body.compute_hydrostatic_stiffness(rho=rho, g=g)
    Mm = np.zeros((6, 6)); Mm[:3, :3] = np.eye(3) * c['mass']; Mm[3:, 3:] = IG
    Mx = body.add_dofs_labels_to_matrix(Mm)
    N = hull.nb_faces + lid.nb_faces
    # memory per worker: the direct method's two influence matrices and an LU factorisation, complex128
    per = 48 * N * N + 3.5e8
    nw = max(1, min(workers, CFG['nFreq'], int(min(7e9, 0.8 * mem_available()) // per)))
    print(f'{cid}: {desc}; {hull.nb_faces} hull + {lid.nb_faces} lid panels; zG {zg:+.4f} m vs Float Sim {-props[cid]["zw"]:+.4f}; '
          f'volume {hull.volume:.5f} m³; {nw} workers', flush=True)
    freqs = [CFG['fMin'] + (CFG['fMax'] - CFG['fMin']) * i / (CFG['nFreq'] - 1) for i in range(CFG['nFreq'])]
    omegas = [2 * math.pi * f for f in freqs]
    for k in ('OMP_NUM_THREADS', 'OPENBLAS_NUM_THREADS', 'MKL_NUM_THREADS'):
        os.environ[k] = str(max(1, (os.cpu_count() or 4) // nw))
    t0 = time.time()
    ctx = mp.get_context('spawn')
    with ctx.Pool(nw, initializer=_init, initargs=(cid, c['mass'], IG.tolist(), rho, g)) as pool:
        parts = []
        for i, ds in enumerate(pool.imap(_solve, sorted(omegas, reverse=True))):
            parts.append(ds)
            if (i + 1) % 10 == 0 or i + 1 == len(omegas):
                print(f'  {cid}: {i + 1}/{len(omegas)} frequencies, {time.time() - t0:.0f} s', flush=True)
    ds = xr.concat(parts, dim='omega', data_vars='minimal', coords='minimal', compat='override').sortby('omega')
    ds['inertia_matrix'] = Mx
    ds['hydrostatic_stiffness'] = C
    rao = cpt.post_pro.rao(ds)                      # omega × wave_direction × radiating_dof, exp(−i w t)
    rao = rao.transpose('wave_direction', 'omega', 'radiating_dof').sel(radiating_dof=DOFS)
    xi = np.conj(rao.values)                        # → exp(+i w t)
    amp = np.abs(xi); amp[..., 3:] *= 180 / math.pi
    phase = np.degrees(np.angle(xi))
    A = ds['added_mass'].transpose('omega', 'influenced_dof', 'radiating_dof').sel(influenced_dof=DOFS, radiating_dof=DOFS).values
    B = ds['radiation_damping'].transpose('omega', 'influenced_dof', 'radiating_dof').sel(influenced_dof=DOFS, radiating_dof=DOFS).values
    X = np.conj(ds['excitation_force'].transpose('omega', 'wave_direction', 'influenced_dof').sel(influenced_dof=DOFS).values)
    Cv = C.sel(influenced_dof=DOFS, radiating_dof=DOFS).values
    out = {
        'solver': f'Capytaine {cpt.__version__} (direct, generate_lid), run on its own', 'id': cid, 'title': c['title'],
        'freqs': freqs, 'headings': CFG['headings'], 'dofs': [d.lower() for d in DOFS],
        'units': 'translations m/m, rotations deg/m; phase deg, exp(+i w t), relative to the wave at G',
        'amp': amp.tolist(), 'phase': phase.tolist(),
        'A': A.tolist(), 'B': B.tolist(), 'X': [[[[float(z.real), float(z.imag)] for z in row] for row in xk] for xk in X],
        'M': Mm.tolist(), 'C': Cv.tolist(), 'zG': zg,
        'mesh': {'panels': int(hull.nb_faces), 'lidPanels': int(lid.nb_faces), 'description': desc, 'volume': float(hull.volume)},
        'wallSeconds': time.time() - t0, 'workers': nw,
    }
    os.makedirs(os.path.join(HERE, 'results', 'capytaine'), exist_ok=True)
    json.dump(out, open(os.path.join(HERE, 'results', 'capytaine', f'{cid}.json'), 'w'))
    print(f'{cid}: done in {time.time() - t0:.0f} s', flush=True)


if __name__ == '__main__':
    args = sys.argv[1:]
    workers = os.cpu_count() or 4
    if '--workers' in args:
        i = args.index('--workers'); workers = int(args[i + 1]); del args[i:i + 2]
    props = json.load(open(os.path.join(HERE, 'results', 'props.json')))
    ids = args or [c['id'] for c in CFG['cases']]
    for c in CFG['cases']:
        if c['id'] in ids:
            run_case(c, props, workers)
