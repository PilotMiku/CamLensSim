"""Build a compact, smoothed head from MakeHuman CC0 mesh + Asian female morph.

Usage: python3 scripts/build_portrait_head.py --base base.obj --target asian-female-young.target
The source OBJ and morph are graphical assets (CC0), not MakeHuman program code.
"""
import argparse
import base64
import json
import struct
from pathlib import Path


def build(vertices, faces, morph):
    faces = [f for f in faces if all(vertices[i][1] > 6.1 and i in morph for i in f)]
    used = sorted({i for f in faces for i in f})
    remap = {old: new for new, old in enumerate(used)}
    positions = [[(vertices[i][j] + morph[i][j]) * 0.10 - [0, 0.55856, 0.0605][j]
                  for j in range(3)] for i in used]
    quads = [[remap[i] for i in face] for face in faces]
    # Catmull-Clark subdivision preserves the orbital, mouth and ear edge loops.
    face_points = [[sum(positions[i][a] for i in face) / len(face) for a in range(3)] for face in quads]
    edges, vertex_faces, vertex_edges = {}, [[] for _ in positions], [set() for _ in positions]
    for fi, face in enumerate(quads):
        for j, v in enumerate(face):
            edge = tuple(sorted((v, face[(j + 1) % len(face)])))
            edges.setdefault(edge, []).append(fi)
            vertex_faces[v].append(fi)
            vertex_edges[v].add(edge)
    smooth = []
    for vi, p in enumerate(positions):
        boundary = [other for edge in vertex_edges[vi] if len(edges[edge]) == 1 for other in edge if other != vi]
        if boundary:
            smooth.append([p[a] * 0.75 + sum(positions[b][a] for b in boundary) / len(boundary) * 0.25 for a in range(3)])
        else:
            count = len(vertex_faces[vi])
            face_average = [sum(face_points[f][a] for f in vertex_faces[vi]) / count for a in range(3)]
            edge_average = [sum((positions[e[0]][a] + positions[e[1]][a]) / 2 for e in vertex_edges[vi]) / len(vertex_edges[vi]) for a in range(3)]
            smooth.append([(face_average[a] + 2 * edge_average[a] + (count - 3) * p[a]) / count for a in range(3)])
    edge_ids = {}
    for edge, adjacent in edges.items():
        edge_ids[edge] = len(smooth)
        if len(adjacent) == 2:
            smooth.append([(positions[edge[0]][a] + positions[edge[1]][a] + sum(face_points[f][a] for f in adjacent)) / 4 for a in range(3)])
        else:
            smooth.append([(positions[edge[0]][a] + positions[edge[1]][a]) / 2 for a in range(3)])
    face_offset = len(smooth)
    smooth.extend(face_points)
    triangles = []
    for fi, face in enumerate(quads):
        for j, v in enumerate(face):
            next_edge = edge_ids[tuple(sorted((v, face[(j + 1) % len(face)])))]
            prev_edge = edge_ids[tuple(sorted((v, face[(j - 1) % len(face)])))]
            triangles.extend([v, next_edge, face_offset + fi, v, face_offset + fi, prev_edge])
    assert len(smooth) < 65536
    quantized = [round(c * 100000) for p in smooth for c in p]
    assert all(-32768 <= c <= 32767 for c in quantized)
    return {"license": "CC0-1.0", "source": "MakeHuman hm08 + asian-female-young.target",
            "units": "metres", "quantization": 0.00001,
            "vertices": len(smooth), "triangles": len(triangles) // 3,
            "positions": base64.b64encode(struct.pack('<' + 'h' * len(quantized), *quantized)).decode(),
            "indices": base64.b64encode(struct.pack('<' + 'H' * len(triangles), *triangles)).decode()}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--base')
    parser.add_argument('--target')
    parser.add_argument('--source-json')
    parser.add_argument('--output', default='src/scenes/assets/portrait-head.json')
    args = parser.parse_args()
    if args.source_json:
        source = json.loads(Path(args.source_json).read_text())
        vertices, faces, morph = source['verts'], source['faces'], dict(source['morph'])
    else:
        vertices, faces, group = [], [], ''
        for line in Path(args.base).read_text().splitlines():
            if line.startswith('v '): vertices.append(list(map(float, line.split()[1:4])))
            elif line.startswith('g '): group = line[2:].strip()
            elif line.startswith('f ') and group == 'body': faces.append([int(v.split('/')[0]) - 1 for v in line.split()[1:]])
        morph = {}
        for line in Path(args.target).read_text().splitlines():
            if line and not line.startswith('#'):
                fields = line.split()
                morph[int(fields[0])] = list(map(float, fields[1:4]))
    result = build(vertices, faces, morph)
    Path(args.output).write_text(json.dumps(result, separators=(',', ':')) + '\n')
    print(f"Head: {result['vertices']} vertices, {result['triangles']} triangles")


if __name__ == '__main__': main()
