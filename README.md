# Semester Study Hub

一个基于 `React + Vite + Supabase` 的学期课程与复习管理网站。

当前版本已经支持：
- 课程与复习条目长期保存到 `Supabase Database`
- 上传文件保存到 `Supabase Storage`
- 页面刷新后保留数据
- 本地开发与线上部署

## 技术栈

- `React 19`
- `Vite`
- `Tailwind CSS`
- `Framer Motion`
- `Supabase Database`
- `Supabase Storage`

## 本地运行

先安装依赖：

```bash
npm install
```

复制环境变量模板：

```bash
cp .env.example .env.local
```

Windows PowerShell：

```powershell
Copy-Item .env.example .env.local
```

然后填写 `.env.local`：

```env
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your-publishable-key
```

启动开发环境：

```bash
npm run dev
```

生产构建：

```bash
npm run build
```

本地预览生产包：

```bash
npm run preview
```

## Supabase 初始化

### 1. 创建数据库表

在 Supabase 后台的 `SQL Editor` 中执行：

- [supabase/schema.sql](supabase/schema.sql)

这会创建：

- `courses`
- `course_weekly_records`
- `course_files`
- `reviews`
- `review_weekly_records`
- `review_files`

### 2. 创建 Storage bucket 和策略

在 Supabase 后台的 `SQL Editor` 中执行：

- [supabase/storage.sql](supabase/storage.sql)

这会创建：

- `study-files` bucket
- 对应的读取、上传、更新、删除策略

## 当前数据保存方式

现在项目的真实保存方式是：

- 课程、复习、周状态、归档信息：`Supabase Database`
- 新上传文件：`Supabase Storage`
- 极少数历史旧文件：页面启动时会尝试从本地迁移到云端

也就是说，正常情况下：

- 刷新页面不会丢
- 关闭浏览器再打开也不会丢
- 换设备访问同一个线上网站，只要连的是同一个 Supabase 项目，也能看到同一份数据

## 部署到 Vercel

### 方式一：网页端部署

1. 把项目推到 GitHub
2. 打开 `Vercel`
3. 选择 `Add New Project`
4. 导入这个仓库
5. Framework 选择 `Vite`
6. Build Command 保持：

```bash
npm run build
```

7. Output Directory 保持：

```bash
dist
```

8. 在 Vercel 的环境变量里添加：

```env
VITE_SUPABASE_URL=你的 Supabase URL
VITE_SUPABASE_PUBLISHABLE_KEY=你的 Supabase Publishable Key
```

9. 点击 `Deploy`

### 方式二：Vercel CLI

先安装：

```bash
npm install -g vercel
```

然后在项目目录执行：

```bash
vercel
```

首次部署完成后，正式上线可用：

```bash
vercel --prod
```

## 上线后建议检查

部署完成后，建议立刻测试：

1. 新建一门课程
2. 修改课程状态并保存
3. 上传一个课程文件
4. 刷新页面，确认数据仍在
5. 打开和下载文件，确认可用
6. 新建一个复习条目，确认课程文件会同步过去

## 重要说明

- 不要把 `service_role` key 放到前端环境变量里
- 前端只应使用 `publishable / anon key`
- `.env.local` 不应提交到仓库

## 关键文件

- [src/App.jsx](src/App.jsx)
- [src/lib/supabase.js](src/lib/supabase.js)
- [supabase/schema.sql](supabase/schema.sql)
- [supabase/storage.sql](supabase/storage.sql)

