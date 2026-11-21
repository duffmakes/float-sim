"""Reference hydrodynamic coefficients from Capytaine (open-source BEM, Ancellin & Dias 2019, validated against WAMIT)
for the panel-method benchmarks in test/validate-bem.js.

    ~/venvs/bem/bin/python test/capytaine_ref.py [case ...]        # writes test/models/capytaine/<case>.json

Each case is meshed analytically at two resolutions (fine = the reference, coarse = half the panel size) so the
reference's own discretisation error is recorded alongside it. Irregular frequencies are removed with a lid.
Capytaine's direct (potential) formulation is used: its default indirect (source) formulation over-predicts the lateral
added mass of slender bodies (+3.05 % on a c/a = 12 prolate spheroid against Lamb's exact value, where the direct
formulation gives −0.25 % on the same mesh).
Output: dimensional A (kg, kg·m, kg·m²), B (N·s/m …) about the stated reference point, excitation X per unit wave
amplitude converted to the WAMIT / Float Sim convention Re{X e^{+iωt}} (Capytaine uses e^{−iωt}, so X is conjugated),
for headings 0° (waves travelling +x) and 90°.
"""
import json, math, sys, time
import numpy as np
import capytaine as cpt

cpt.set_logging('WARNING')
RHO, G = 1000.0, 9.81
DOFS = ['Surge', 'Sway', 'Heave', 'Roll', 'Pitch', 'Yaw']


def vcyl(a, T, h):
    """Vertical circular cylinder, radius a, draft T, waterline at z = 0, panel size ≈ h."""
    nt = max(16, int(math.ceil(2 * math.pi * a / h)))
    return cpt.mesh_vertical_cylinder(length=2 * T, radius=a, center=(0, 0, 0),
                                      resolution=(max(2, int(math.ceil(a / h))), nt, max(2, int(math.ceil(2 * T / h))))).immersed_part()


def sphere(r, zc, h):
    nt = max(16, int(math.ceil(2 * math.pi * r / h)))
    return cpt.mesh_sphere(radius=r, center=(0, 0, zc), resolution=(max(8, nt // 2), nt)).immersed_part()


def box(L, B, T, h):
    return cpt.mesh_parallelepiped(size=(L, B, 2 * T), center=(0, 0, 0),
                                   resolution=(max(2, int(math.ceil(L / h))), max(2, int(math.ceil(B / h))), max(2, int(math.ceil(2 * T / h))))).immersed_part()


def hcyl(r, L, zc, h):
    nt = max(16, int(math.ceil(2 * math.pi * r / h)))
    return cpt.mesh_horizontal_cylinder(length=L, radius=r, center=(0, 0, zc),
                                        resolution=(max(2, int(math.ceil(r / h))), nt, max(2, int(math.ceil(L / h))))).immersed_part()


def box_lid(L, B, h):
    """waterplane lid of a box (Capytaine's generate_lid returns an empty lid for the 40 m barge)"""
    return cpt.mesh_rectangle(size=(L, B), center=(0, 0, 0), resolution=(max(2, int(math.ceil(L / h))), max(2, int(math.ceil(B / h)))))


# name: (mesh(h), fine h, reference point, frequencies, description[, lid(h)])
CASES = {
    'cyl_buoy': (lambda h: vcyl(0.35, 0.63, h), 0.025, (0, 0, -0.4), np.linspace(1.0, 10.0, 24),
                 'Vertical cylinder buoy a 0.35 m, draft 0.63 m (the WAMIT "cyl" geometry), deep water'),
    'kramer_sphere': (lambda h: sphere(0.15, 0.0, h), 0.008, (0, 0, -0.0348), np.linspace(3.0, 22.0, 24),
                      'Kramer et al. (2021) sphere D 0.3 m, floating at the equator, CoG 34.8 mm below the centre'),
    'cube': (lambda h: box(1.0, 1.0, 0.85, h), 0.04, (0, 0, -0.35), np.linspace(1.0, 7.0, 22),
             '1 m cube, s.g. 0.85 (draft 0.85 m), CoG at the cube centre'),
    'hcyl_log': (lambda h: hcyl(0.2, 3.0, 0.0, h), 0.04, (0, 0, -0.05), np.linspace(1.0, 10.0, 22),
                 'Log Ø0.4 × 3 m, axis along x at the waterline, CoG 50 mm below the axis'),
    'squat_cyl': (lambda h: vcyl(0.5, 0.2, h), 0.025, (0, 0, 0.0), np.linspace(1.0, 10.0, 24),
                  'Discus-like cylinder r 0.5 m, draft 0.2 m (H 0.4 m, s.g. ½), CoG at the waterline'),
    'spar': (lambda h: vcyl(0.5, 6.0, h), 0.12, (0, 0, -5.0), np.linspace(0.3, 3.0, 22),
             'Deep-draft spar a 0.5 m, draft 6 m, CoG 1 m above the keel'),
    'iti_barge': (lambda h: box(40.0, 40.0, 4.0, h), 1.0, (0, 0, 0), np.linspace(0.3, 2.0, 18),
                  'ITI Energy barge hull 40 × 40 m, draft 4 m (moonpool left out), reference point at the waterplane centre',
                  lambda h: box_lid(40.0, 40.0, h)),
}


def run(mesh, ref, omegas, depth=None, lid=True):
    lid_mesh = (mesh.generate_lid(z=0.0) if lid is True else lid) if lid is not None and lid is not False else None
    if lid_mesh is not None and lid_mesh.nb_faces == 0: raise ValueError('empty lid: pass a lid mesh for this case')
    body = cpt.FloatingBody(mesh=mesh, lid_mesh=lid_mesh,
                            dofs=cpt.rigid_body_dofs(rotation_center=ref), center_of_mass=ref)
    solver = cpt.BEMSolver(method='direct')
    probs = [cpt.RadiationProblem(body=body, omega=w, radiating_dof=d, rho=RHO, g=G, water_depth=depth or np.inf) for w in omegas for d in DOFS]
    probs += [cpt.DiffractionProblem(body=body, omega=w, wave_direction=b, rho=RHO, g=G, water_depth=depth or np.inf) for w in omegas for b in (0.0, math.pi / 2)]
    res = solver.solve_all(probs, progress_bar=False)
    ds = cpt.assemble_dataset(res)
    out = {'w': [float(w) for w in omegas], 'A': [], 'B': [], 'X0': [], 'X90': []}
    for w in omegas:
        a = ds['added_mass'].sel(omega=w)
        b = ds['radiation_damping'].sel(omega=w)
        # A_ij: force in i due to motion j  →  influenced_dof = i, radiating_dof = j
        out['A'].append([[float(a.sel(influenced_dof=i, radiating_dof=j)) for j in DOFS] for i in DOFS])
        out['B'].append([[float(b.sel(influenced_dof=i, radiating_dof=j)) for j in DOFS] for i in DOFS])
        for key, beta in (('X0', 0.0), ('X90', math.pi / 2)):
            x = ds['excitation_force'].sel(omega=w, wave_direction=beta)
            out[key].append([[float(np.real(x.sel(influenced_dof=i))), -float(np.imag(x.sel(influenced_dof=i)))] for i in DOFS])
    return out, mesh.nb_faces, body.lid_mesh.nb_faces if body.lid_mesh is not None else 0


def sanity_wamit():
    """Capytaine on the WAMIT 'cyl' run (3 m depth, IRR on): confirms the conventions used here."""
    ref = json.load(open('test/models/wamit/cyl.json'))
    ws = [ref['w'][k] for k in (8, 20, 35, 50)]
    out, nb, nl = run(vcyl(0.35, 0.63, 0.03), (0, 0, 0), ws, depth=ref['depth'])
    print(f'sanity: Capytaine vs WAMIT cyl (depth {ref["depth"]} m), {nb} + {nl} lid panels')
    for n, w in enumerate(ws):
        k = ref['w'].index(w)
        row = []
        for key, (i, j) in (('A33', (2, 2)), ('B33', (2, 2)), ('A11', (0, 0)), ('B11', (0, 0)), ('A55', (4, 4)), ('A15', (0, 4))):
            mat = out['A' if key[0] == 'A' else 'B'][n][i][j]
            wv = ref[key[0]][k][f'{i + 1}{j + 1}'] * RHO
            row.append(f'{key} {100 * (mat / wv - 1):+.2f}%')
        for i in (0, 2, 4):
            xc = complex(*out['X0'][n][i]); xw = complex(*ref['X'][k][str(i + 1)]) * RHO * ref['g']
            row.append(f'X{i + 1} |{100 * (abs(xc) / abs(xw) - 1):+.2f}%| ∠{math.degrees(math.atan2((xc / xw).imag, (xc / xw).real)):+.1f}°')
        print(f'  ω {w:.3f}: ' + '  '.join(row))


if __name__ == '__main__':
    names = sys.argv[1:] or ['sanity', *CASES]
    if 'sanity' in names:
        sanity_wamit(); names = [n for n in names if n != 'sanity']
    for name in names:
        mk, h, ref, omegas, desc, *lid = CASES[name]
        mklid = lid[0] if lid else (lambda _h: True)
        t0 = time.time()
        fine, nb, nl = run(mk(h), ref, omegas, lid=mklid(h))
        coarse, nbc, nlc = run(mk(2 * h), ref, omegas, lid=mklid(2 * h))
        # reference uncertainty: fine vs coarse, scaled by the peak of each coefficient over frequency
        def spread(key, i, j=None):
            f = np.array([(m[i][j] if j is not None else math.hypot(*m[i])) for m in fine[key]])
            c = np.array([(m[i][j] if j is not None else math.hypot(*m[i])) for m in coarse[key]])
            return float(np.max(np.abs(f - c)) / max(np.max(np.abs(f)), 1e-300))
        unc = {f'{k}{i + 1}{i + 1}': spread(k, i, i) for k in ('A', 'B') for i in range(6) if abs(fine[k][0][i][i]) > 0 or abs(fine[k][-1][i][i]) > 0}
        unc.update({f'X{i + 1}': spread('X0', i) for i in range(6)})
        data = {'source': f'Capytaine {cpt.__version__} (Ancellin & Dias 2019), direct formulation, lid for irregular frequencies, infinite depth',
                'description': desc, 'rho': RHO, 'g': G, 'depth': None, 'ref': list(ref),
                'panels': nb, 'lid_panels': nl, 'coarse_panels': nbc,
                'note': 'A, B dimensional about ref (row = force, column = motion); X per metre of wave amplitude in the exp(+i w t) convention, X0 heading 0 deg, X90 heading 90 deg; unc = max |fine - coarse| / max |fine| per coefficient',
                'unc': unc, **fine}
        json.dump(data, open(f'test/models/capytaine/{name}.json', 'w'), separators=(',', ':'))
        print(f'{name}: {nb} + {nl} lid panels (coarse {nbc}), {len(omegas)} frequencies, {time.time() - t0:.0f} s; '
              f'reference spread: ' + ', '.join(f'{k} {100 * v:.2f}%' for k, v in unc.items() if v > 0))
