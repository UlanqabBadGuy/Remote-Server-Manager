# Tasks

- [x] Task 1: 项目脚手架搭建
  - [x] 使用 `npm create tauri-app@latest` 创建 Tauri v2 + React + TypeScript 项目
  - [x] 配置 Rust 后端依赖：russh、serde、serde_json、keyring、tokio
  - [x] 配置前端依赖：xterm、xterm-addon-fit、xterm-addon-web-links、@tauri-apps/api、@tauri-apps/plugin-dialog、zustand
  - [x] 配置 Tauri 权限和插件：dialog、shell、fs
  - [x] 清理模板代码，建立基础项目结构

- [x] Task 2: Rust 后端 - 数据模型与持久化
  - [x] 定义连接配置数据结构（ConnectionConfig）：id、名称、主机、端口、用户名、认证方式、分组、备注
  - [x] 实现配置文件读写（JSON 格式存储到 app data 目录）
  - [x] 实现连接配置的 CRUD Tauri 命令（list_connections、add_connection、update_connection、delete_connection）
  - [x] 实现分组管理（list_groups、add_group、delete_group）
  - [x] 实现连接配置导入/导出功能

- [x] Task 3: Rust 后端 - SSH 连接与终端
  - [x] 实现 SSH 连接建立（密码认证 + 私钥认证）
  - [x] 实现 SSH 会话管理（创建、关闭、心跳检测）
  - [x] 实现终端通道（PTY 分配、终端大小调整）
  - [x] 实现终端输入/输出数据流，通过 Tauri Event 与前端通信
  - [x] 定义 Tauri 命令：ssh_connect、ssh_disconnect、ssh_write、ssh_resize

- [x] Task 4: Rust 后端 - SFTP 文件操作
  - [x] 实现 SFTP 通道建立
  - [x] 实现远程目录列表读取（sftp_list_directory）
  - [x] 实现文件上传（sftp_upload_file）
  - [x] 实现文件下载（sftp_download_file）
  - [x] 实现文件删除（sftp_delete_file）
  - [x] 实现文件重命名（sftp_rename_file）
  - [x] 实现创建目录（sftp_create_directory）
  - [x] 定义对应的 Tauri 命令

- [x] Task 5: Rust 后端 - 凭证安全存储
  - [x] 集成 keyring crate，使用系统原生密钥链
  - [x] 实现密码的加密存储和读取
  - [x] 连接时自动从密钥链获取凭证
  - [x] 实现凭证的删除和更新

- [x] Task 6: 前端 - 布局与导航框架
  - [x] 实现主布局：左侧连接列表 + 右侧主内容区（标签页）
  - [x] 实现标签页组件（新增、切换、关闭）
  - [x] 实现全局状态管理（zustand store）
  - [x] 实现主题切换（亮色/暗色）

- [x] Task 7: 前端 - 连接管理界面
  - [x] 实现连接列表组件（分组折叠、搜索过滤）
  - [x] 实现连接编辑对话框（新增/编辑表单）
  - [x] 实现连接右键菜单（连接、编辑、删除、复制）
  - [x] 实现快速连接功能（不保存配置的临时连接）

- [x] Task 8: 前端 - 远程文件浏览器
  - [x] 实现目录树组件（懒加载、展开/折叠）
  - [x] 实现文件列表视图（名称、大小、权限、修改时间）
  - [x] 实现文件操作工具栏（上传、下载、删除、重命名、新建文件夹）
  - [x] 实现文件上传/下载进度显示
  - [x] 实现面包屑导航

- [x] Task 9: 前端 - 内置终端
  - [x] 集成 xterm.js 创建终端组件
  - [x] 实现终端数据流与 Rust 后端的双向绑定
  - [x] 实现终端自适应窗口大小（xterm-addon-fit）
  - [x] 实现终端 Web 链接点击（xterm-addon-web-links）
  - [x] 实现复制粘贴快捷键支持

- [x] Task 10: 集成测试与打包
  - [x] 编译验证：Rust cargo check 零错误零警告，TypeScript tsc --noEmit 零错误，前端 npm run build 成功
  - [x] 跨平台编译配置（Tauri bundler 配置 Linux/Windows/macOS 目标）
  - [x] 应用图标和元数据已配置

# Task Dependencies
- Task 2、3、4、5 依赖 Task 1（项目脚手架）
- Task 6 依赖 Task 1（项目脚手架）
- Task 7 依赖 Task 2、Task 6
- Task 8 依赖 Task 4、Task 6
- Task 9 依赖 Task 3、Task 6
- Task 10 依赖 Task 7、8、9
- Task 2、3、4、5 可并行开发
- Task 7、8、9 可并行开发