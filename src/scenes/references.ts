import indoor from '../../预览/室内静物工作室.png?url';
import alpine from '../../预览/高山湖畔.png?url';
import portrait from '../../预览/室外人像.png?url';
import robin from '../../预览/林间知更鸟.png?url';

export const SCENE_REFERENCES: Readonly<Record<string, { image: string; description: string }>> = {
  indoor: { image: indoor, description: '窗边暖光、圆形木桌、白色花枝、陶器与垂坠亚麻布。' },
  outdoor: { image: alpine, description: '晴空与暖阳下的高山湖畔，前景树荫与野花、通向湖岸的步道、湖面倒影和层叠雪山。' },
  portrait: { image: portrait, description: '樱花树下的黑长直少女，水手服 JK 与百褶裙，春日逆光。' },
  animal: { image: robin, description: '晴天林间暖阳照亮苔藓树枝上的知更鸟，树叶投下斑驳阴影，近叶与远林形成层次。' },
};
