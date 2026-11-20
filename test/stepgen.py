"""Minimal AP214 STEP writer for exact B-rep test solids (standard library only).

Supports
  * convex-faced polyhedra (planar faces, straight edges)
  * right circular cylinders (two planar caps + one CYLINDRICAL_SURFACE face with a seam)

Each solid can also be tessellated here (for the Python cross-check), and a written file can be
re-parsed with `check_topology` to confirm that it is a closed, consistently oriented manifold shell.
"""
import math
import re


def _r(x):
    """STEP REAL: must contain a decimal point."""
    s = f"{float(x):.12G}"
    if 'E' in s:
        m, e = s.split('E')
        if '.' not in m:
            m += '.'
        return f"{m}E{e}"
    return s if '.' in s else s + '.'


def _sub(a, b): return [a[i] - b[i] for i in range(3)]
def _add(a, b): return [a[i] + b[i] for i in range(3)]
def _mul(a, k): return [a[i] * k for i in range(3)]
def _dot(a, b): return sum(a[i] * b[i] for i in range(3))
def _cross(a, b): return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
def _unit(a):
    n = math.sqrt(_dot(a, a)); return [c / n for c in a]


class Polyhedron:
    def __init__(self, verts, faces):
        self.verts = [list(map(float, v)) for v in verts]
        self.faces = faces  # lists of vertex indices, CCW seen from outside

    def tris(self):
        out = []
        for f in self.faces:
            for k in range(1, len(f) - 1):
                for i in (f[0], f[k], f[k + 1]):
                    out += self.verts[i]
        return out


class Cylinder:
    def __init__(self, base, axis, ref, r, h):
        self.base, self.axis, self.ref = list(base), _unit(axis), _unit(ref)
        self.r, self.h = r, h

    def tris(self, n=720):
        a, x = self.axis, self.ref
        y = _cross(a, x)
        top = _add(self.base, _mul(a, self.h))
        ring = lambda c, t: _add(c, _add(_mul(x, self.r * math.cos(t)), _mul(y, self.r * math.sin(t))))
        out = []
        for i in range(n):
            t0, t1 = 2 * math.pi * i / n, 2 * math.pi * (i + 1) / n
            b0, b1, u0, u1 = ring(self.base, t0), ring(self.base, t1), ring(top, t0), ring(top, t1)
            out += b0 + b1 + u1 + b0 + u1 + u0          # side (outward)
            out += self.base + b1 + b0                  # bottom cap (normal −axis)
            out += top + u0 + u1                        # top cap (normal +axis)
        return out


def box(lx, ly, lz, origin=(0, 0, 0)):
    """axis-aligned box with its min corner at origin"""
    o = origin
    v = [(o[0] + dx * lx, o[1] + dy * ly, o[2] + dz * lz) for dz in (0, 1) for dy in (0, 1) for dx in (0, 1)]
    # index = dx + 2 dy + 4 dz
    f = [[0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4], [2, 6, 7, 3], [0, 4, 6, 2], [1, 3, 7, 5]]
    return Polyhedron(v, f)


def prism_x(section_yz, length, x0=0.0):
    """extrude a convex CCW (y, z) polygon along +x"""
    n = len(section_yz)
    v = [(x0, y, z) for y, z in section_yz] + [(x0 + length, y, z) for y, z in section_yz]
    faces = [list(range(n))[::-1], list(range(n, 2 * n))]          # x0 end (normal −x), far end (+x)
    for i in range(n):
        j = (i + 1) % n
        faces.append([i, j, n + j, n + i])
    return Polyhedron(v, faces)


def transform(poly, R, t):
    """rigidly move a polyhedron: v' = R v + t"""
    vs = [[sum(R[r][c] * v[c] for c in range(3)) + t[r] for r in range(3)] for v in poly.verts]
    return Polyhedron(vs, poly.faces)


class StepWriter:
    def __init__(self):
        self.lines = []

    def add(self, s):
        self.lines.append(s)
        return f"#{len(self.lines)}"

    def pt(self, p): return self.add(f"CARTESIAN_POINT('',({','.join(_r(c) for c in p)}))")
    def dir(self, d): return self.add(f"DIRECTION('',({','.join(_r(c) for c in _unit(d))}))")
    def ax2(self, p, z, x): return self.add(f"AXIS2_PLACEMENT_3D('',{self.pt(p)},{self.dir(z)},{self.dir(x)})")
    def vtx(self, p): return self.add(f"VERTEX_POINT('',{self.pt(p)})")

    def line_edge(self, p0, p1, v0, v1):
        d = _sub(p1, p0)
        vec = self.add(f"VECTOR('',{self.dir(d)},{_r(math.sqrt(_dot(d, d)))})")
        ln = self.add(f"LINE('',{self.pt(p0)},{vec})")
        return self.add(f"EDGE_CURVE('',{v0},{v1},{ln},.T.)")

    def face(self, oriented, plane_or_surf, sense=True):
        oes = [self.add(f"ORIENTED_EDGE('',*,*,{e},{'.T.' if fwd else '.F.'})") for e, fwd in oriented]
        loop = self.add(f"EDGE_LOOP('',({','.join(oes)}))")
        bound = self.add(f"FACE_OUTER_BOUND('',{loop},.T.)")
        return self.add(f"ADVANCED_FACE('',({bound}),{plane_or_surf},{'.T.' if sense else '.F.'})")

    # ---- solids → list of ADVANCED_FACE refs
    def polyhedron(self, P):
        vids = [self.vtx(v) for v in P.verts]
        edges = {}
        faces = []
        for f in P.faces:
            a, b, c = (P.verts[i] for i in f[:3])
            nrm = _unit(_cross(_sub(b, a), _sub(c, a)))
            plane = self.add(f"PLANE('',{self.ax2(a, nrm, _sub(b, a))})")
            oriented = []
            for k in range(len(f)):
                i, j = f[k], f[(k + 1) % len(f)]
                key = (min(i, j), max(i, j))
                if key not in edges:
                    edges[key] = self.line_edge(P.verts[key[0]], P.verts[key[1]], vids[key[0]], vids[key[1]])
                oriented.append((edges[key], i < j))
            faces.append(self.face(oriented, plane))
        return faces

    def cylinder(self, C):
        a, x = C.axis, C.ref
        top = _add(C.base, _mul(a, C.h))
        pb, pt = _add(C.base, _mul(x, C.r)), _add(top, _mul(x, C.r))
        vb, vt = self.vtx(pb), self.vtx(pt)
        cb = self.add(f"CIRCLE('',{self.ax2(C.base, a, x)},{_r(C.r)})")
        ct = self.add(f"CIRCLE('',{self.ax2(top, a, x)},{_r(C.r)})")
        eb = self.add(f"EDGE_CURVE('',{vb},{vb},{cb},.T.)")
        et = self.add(f"EDGE_CURVE('',{vt},{vt},{ct},.T.)")
        seam = self.line_edge(pb, pt, vb, vt)
        surf = self.add(f"CYLINDRICAL_SURFACE('',{self.ax2(C.base, a, x)},{_r(C.r)})")
        side = self.face([(eb, True), (seam, True), (et, False), (seam, False)], surf)
        bot = self.face([(eb, False)], self.add(f"PLANE('',{self.ax2(C.base, _mul(a, -1), x)})"))
        topf = self.face([(et, True)], self.add(f"PLANE('',{self.ax2(top, a, x)})"))
        return [side, bot, topf]

    def write(self, path, solid, name):
        self.lines = []
        L = self.add
        app = L("APPLICATION_CONTEXT('automotive design')")
        L(f"APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2000,{app})")
        pc = L(f"PRODUCT_CONTEXT('',{app},'mechanical')")
        prod = L(f"PRODUCT('{name}','{name}','',({pc}))")
        L(f"PRODUCT_RELATED_PRODUCT_CATEGORY('part',$,({prod}))")
        pdc = L(f"PRODUCT_DEFINITION_CONTEXT('part definition',{app},'design')")
        pdf = L(f"PRODUCT_DEFINITION_FORMATION('','',{prod})")
        pd = L(f"PRODUCT_DEFINITION('design','',{pdf},{pdc})")
        pds = L(f"PRODUCT_DEFINITION_SHAPE('','',{pd})")
        lu = L("(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT(.MILLI.,.METRE.))")
        au = L("(NAMED_UNIT(*)PLANE_ANGLE_UNIT()SI_UNIT($,.RADIAN.))")
        su = L("(NAMED_UNIT(*)SI_UNIT($,.STERADIAN.)SOLID_ANGLE_UNIT())")
        unc = L(f"UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.E-07),{lu},'distance_accuracy_value','confusion accuracy')")
        ctx = L(f"(GEOMETRIC_REPRESENTATION_CONTEXT(3)GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT(({unc}))"
                f"GLOBAL_UNIT_ASSIGNED_CONTEXT(({lu},{au},{su}))REPRESENTATION_CONTEXT('Context','3D'))")
        faces = self.polyhedron(solid) if isinstance(solid, Polyhedron) else self.cylinder(solid)
        shell = L(f"CLOSED_SHELL('',({','.join(faces)}))")
        brep = L(f"MANIFOLD_SOLID_BREP('{name}',{shell})")
        origin = self.ax2([0, 0, 0], [0, 0, 1], [1, 0, 0])
        rep = L(f"ADVANCED_BREP_SHAPE_REPRESENTATION('',({origin},{brep}),{ctx})")
        L(f"SHAPE_DEFINITION_REPRESENTATION({pds},{rep})")
        body = '\n'.join(f"#{i + 1}={s};" for i, s in enumerate(self.lines))
        with open(path, 'w') as fh:
            fh.write("ISO-10303-21;\nHEADER;\n"
                     f"FILE_DESCRIPTION(('Float Sim validation body: {name}'),'2;1');\n"
                     f"FILE_NAME('{name}.step','2026-11-20T00:00:00',(''),(''),'float-sim stepgen','float-sim','');\n"
                     "FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));\nENDSEC;\nDATA;\n"
                     f"{body}\nENDSEC;\nEND-ISO-10303-21;\n")


def check_topology(path):
    """Re-parse a STEP file: every edge must be used exactly twice, once in each direction,
    every loop must be connected end-to-start, and every #ref must resolve."""
    ents = {}
    for m in re.finditer(r"#(\d+)=(.*?);\s*$", open(path).read(), re.M):
        ents[int(m.group(1))] = m.group(2)
    refs = lambda s: [int(x) for x in re.findall(r"#(\d+)", s)]
    for k, s in ents.items():
        for r in refs(s):
            if r not in ents:
                return False, f"#{k} references missing #{r}"
    uses = {}
    for k, s in ents.items():
        if s.startswith('EDGE_LOOP'):
            seq = []
            for oe in refs(s):
                o = ents[oe]
                e = refs(o)[0]
                fwd = o.rstrip(')').endswith('.T.')
                v0, v1 = refs(ents[e])[:2]
                seq.append((v0, v1) if fwd else (v1, v0))
                uses.setdefault(e, []).append(fwd)
            for i in range(len(seq)):
                if seq[i][1] != seq[(i + 1) % len(seq)][0]:
                    return False, f"loop #{k} is not connected"
    for e, u in uses.items():
        if sorted(u) != [False, True]:
            return False, f"edge #{e} used {u}"
    return True, f"{len(ents)} entities, {len(uses)} edges, closed & consistently oriented"
