# Portrait anatomy asset

`portrait-head.json` is a derived **CC0-1.0** graphical asset. It contains a head and neck extracted from the MakeHuman hm08 body mesh, with the `asian-female-young` morph applied, one Catmull-Clark subdivision step, and positions quantized to 10 micrometres. It contains 16,833 vertices and 33,568 triangles. Units are metres.

Sources, retrieved 2026-11-04:

- Base mesh: https://github.com/makehumancommunity/makehuman/blob/master/makehuman/data/3dobjs/base.obj
- Morph: https://github.com/makehumancommunity/makehuman/blob/master/makehuman/data/targets/macrodetails/asian-female-young.target
- Asset licence: https://github.com/makehumancommunity/makehuman/blob/master/LICENSE.md
- Community licence explanation: https://www.makehumancommunity.org/about/license.html

The original graphical assets credit Data Collection AB, Joel Palmius, Jonas Hauquier, and (for the morph) Manuel Bastioni. The original headers explicitly dedicate these graphical assets to CC0. No MakeHuman application source code is included.

To rebuild from the original source assets:

```sh
python3 scripts/build_portrait_head.py --base /path/to/base.obj --target /path/to/asian-female-young.target
```

`src/scenes/anatomicalHead.ts` decodes the local mesh and computes normals and skin colour. The scalp follows this mesh. Hair, garments, eyes, botanical geometry and lighting are implemented separately in the simulator. The result is an independently modelled portrait subject inspired by the reference composition; it is not a reconstruction of the exact person's identity or a full photogrammetry scan.
