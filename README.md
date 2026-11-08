# CamLensSim

运行在浏览器中的摄影光学实验室，通过四个三维场景探索焦距、光圈、画幅、对焦距离和机位的关系。所有计算在本地完成，无需后端或 API Key。

[在线体验](https://pilotmiku.github.io/CamLensSim/) · [架构说明](docs/architecture.md)

## 主要功能

- **四个场景**：室内静物、高山湖畔、室外人像、林间知更鸟，支持自由移动与点击对焦。
- **器材模拟**：全画幅、APS-C、M4/3、中画幅；22 支虚拟镜头，包含变焦、定焦、移轴、鱼眼和折返镜头。
- **光学观察**：视角、等效焦距、景深、超焦距、放大率，以及曝光、衍射和传感器噪声预览。
- **实时与光追**：景深虚化、反射、折射、遮挡和间接照明；独立太阳模型与灯具光源参与光照计算。
- **四档画质**：精细 100%、均衡 85%、性能 70%、流畅 50%，按取景器原生宽高缩放。

## 本地运行

需要 Node.js 22.12+，推荐 Node.js 24。三维预览需要支持 WebGL2 的浏览器。

```sh
npm ci
npm run dev
```

打开终端显示的地址，通常为 http://127.0.0.1:5173。

## 基本操作

- 拖动画面环视，滚轮推拉，点击物体对焦。
- `W/A/S/D` 移动，`J/K` 水平转向，`I/O` 俯仰，`R/F` 升降；`Shift` 加速，`Alt` 慢速。
- 手机和平板可使用虚拟摇杆移动与转向。
- 开启「自动跟焦」可锁定物体；手动对焦支持至 100 km 和无穷远 `∞`。
- 「景深预览」用于对照虚化效果；「恒定曝光预览」便于在亮度不变时比较光圈与景深。

## 开发与部署

使用 React、TypeScript、Vite 和 Three.js，光追基于 three-gpu-pathtracer。

```sh
npm test                 # 单元测试
npm run typecheck        # 类型检查
npm run build            # 构建到 dist/
npm run preview          # 预览构建
npm run test:e2e         # 桌面与移动端浏览器测试
```

浏览器测试默认使用本机 Google Chrome，也可使用 Playwright Chromium：

```sh
npx playwright install chromium
PLAYWRIGHT_CHANNEL=chromium npm run test:e2e
```

部署到 GitHub Pages：在仓库 **Settings → Pages → Source** 选择 **GitHub Actions**，然后推送到 `main`。工作流会执行类型检查、单元测试、两片桌面浏览器验证和构建，全部通过后发布；PR 仅验证。

## 模型边界与资料

本项目用于教学，器材参数与视觉效果均为近似模型，不代表实际品牌相机。未模拟复杂镜头像差、运动模糊或完整大气散射；鱼眼、折返及镜头倾斜使用实时模式。详细公式、渲染实现与限制见[架构说明](docs/architecture.md)。

人物头部使用随源码提供的 CC0 网格，其余场景主要由程序化几何生成。详见[资源说明](src/scenes/assets/README.md)；原始需求见 [writing-block.md](writing-block.md)。

## License

[MIT](LICENSE)
