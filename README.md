# Photo Collage Print

一个面向 100 × 148 mm（6 英寸）相纸的浏览器端照片排版工具。照片只在本机浏览器中处理，可以调整裁切位置、缩放与旋转，并导出 300 DPI JPEG 文件。

在线体验：[photo-collage-print.vercel.app](https://photo-collage-print.vercel.app/)

## 功能

- 2-up：上下两行，每格约 100 × 73.75 mm
- 4-up：2 × 2 网格，每格约 49.75 × 73.75 mm
- JPG、PNG 多文件上传
- 根据裁切利用率自动选择是否旋转 90°
- 鼠标和触控拖拽、双指缩放、双击重置
- 格子间拖拽交换照片
- 0.3–2.0 mm 可调留白
- 单页导出 JPEG，多页自动打包 ZIP
- 所有照片均在浏览器本地处理，不上传服务器

## 打印参数

| 项目 | 数值 |
| --- | --- |
| 相纸尺寸 | 100 × 148 mm |
| 导出分辨率 | 1181 × 1748 px |
| 目标精度 | 300 DPI |
| JPEG 质量 | 0.95 |
| 默认留白 | 0.5 mm |

2-up 默认导出为上下两个 1181 × 871 px 区域，中间使用 6 px 白色留白。4-up 保持标准 2 × 2 排列。

## 本地运行

需要 Node.js 20.9 或更高版本。

~~~bash
npm install
npm run dev
~~~

打开 [http://localhost:3000](http://localhost:3000)。

生产构建：

~~~bash
npm run lint
npm run build
npm start
~~~

## 技术栈

- Next.js 16
- React 19
- TypeScript
- Tailwind CSS 4
- Pointer Events
- Canvas API

## 项目结构

~~~text
app/
├── globals.css   # 页面样式与响应式布局
├── layout.tsx    # 页面元数据和根布局
└── page.tsx      # 上传、编辑、手势与导出逻辑
public/
└── favicon.svg
~~~

## 隐私

上传的图片以浏览器对象 URL 读取，预览、压缩和导出过程均在客户端完成。应用没有照片上传接口，也不需要账号。
