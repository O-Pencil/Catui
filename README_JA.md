# Catui

![Catui — あなたのターミナル。あなたのコーディング仲間。](assets/readme/header.png)

ターミナルを主軸とした AI コーディングエージェント。プロジェクトをまたぐ永続メモリ、切り替え可能なペルソナ、拡張可能なツールを備えます。TypeScript と Node.js で構築され、`catui-agent` として公開されています。

[English](README.md) · [中文](README_CN.md) · [Русский](README_RU.md) · [SDK](docs/sdk.md)

## はじめに

Node.js 20 以降が必要です。

```bash
npm install -g catui-agent
catui
```

プロバイダの設定は `/login`、モデルの選択は `/model`、アイデンティティの選択は `/persona` で行います。プロバイダの認証情報は環境変数からも渡せます（後述の「プロバイダ設定」を参照）。実際に使えるモデルは設定済みプロバイダとアカウントに依存します。Anthropic、OpenAI、Google、Alibaba DashScope / Token Plan、ローカル Ollama などが利用可能です。

```bash
catui -c                            # 前回のセッションを続行
catui -r                            # 履歴からセッションを選んで再開
catui -p "このリポジトリを説明して" # 単発実行して終了
catui --mode rpc                    # stdio 経由の JSON-lines 連携
catui --acp                         # ACP 経由のエディタ連携
catui --serve --host 127.0.0.1      # HTTP / WebSocket でリモート制御
catui --help                        # 全 CLI オプション
```

ターミナル UI が基本インターフェースです。本リポジトリにはリモートサーバと、別途モバイル向け Web / Capacitor クライアントも含まれます（[リモートモード](docs/remote.md) を参照）。ルートビルドではモバイルアプリはビルドされません。

## 同梱されているもの

### 現在のセッションに Codex を接続する

macOS / Linux で、Catui 内で `/bridge start` を実行し、初回のみプラグインのインストールを承認します。新しい Codex のチャットを開いて「Catui のセッションに接続して」と依頼してください。拡張パスや鍵、ポート番号をコピーする必要はありません。接続状態は `/bridge status`、インストール再試行は `/bridge setup`、切断は `/bridge stop` です。プラグイン対応の Codex が必要です。Codex はコマンド一覧を把握し、通常タスクや Grub / Goal を指揮し、Plan の依頼をレビューし、委任された質問に回答できます。リモートアダプタのないコマンドや、権限昇格の承認はローカルのままです。Catui が実行し、Codex が結果と証拠を確認して完了を承認します。詳細は[接続ガイド](extensions/optional/session-bridge/README.md)。

### 含まれる機能

- **ツールとセッション**：ファイルの閲覧 / 編集、シェル実行、モデル切替、ストリーミング応答、セッション履歴、ブランチ、コンパクション、HTML エクスポート。
- **メモリとペルソナ**：NanoMem がプロジェクト知識や設定を保持。ペルソナファイルがアイデンティティと作業スタイルを定義。**NanoSoul は停止中**：自動初期化、人格注入、学習は発生しません。既存の Soul データは変更されません。旧 SDK の Soul オプションは無視されます。
- **拡張性**：組み込み / ユーザ拡張がツール、コマンド、ライフサイクルフックを登録。MCP で外部ツールサーバを接続。Browser Harness は opt-in。
- **ワークフロー**：エンジニアリング規律スキル、プランニング、サブエージェント / チーム、`/goal`、`/grub`、`/loop`、リサーチ / 執筆スキル。読み込まれたリソースは `/resources` で確認できます（モードや設定により変わります）。
- **ランタイム制御**：ツールポリシー、有界リカバリ、実行トレース、再生 / 評価ツール。[ランタイムトレース](docs/run-trace-and-replay.md) を参照。

## デフォルトの判断スキル

デフォルトの `typesafe` 拡張には 2 つのスキルが含まれます。

| Skill | 用途 |
| --- | --- |
| `agent-decision-loop` | 次の一手を選び、証拠に基づいてツール引数を組み立て、結果を評価し、進捗が止まったら方針を変える |
| `typesafe-ai` | 型付き判断と最新ドキュメントで TypeSafe System One 連携を構築する |

各ユーザーターンの末尾に、判断 / ツール / 評価の短いガイドが追加されます。スキルの本体は Skill ツールまたは `/skill:agent-decision-loop`、`/skill:typesafe-ai` でオンデマンド読み込みされます。CLI モードとヘッドレス SDK の両方で動作します。

通常の Catui 作業は設定済みモデルと既存ツールを使うため、TypeSafe アカウントは不要で、TypeSafe の API 呼び出しも発生しません。実際に TypeSafe 連携を組む場合は、そのサービスの認証情報が別途必要です。スキルガイドは実行時の正しさやモデル誤り率の減少を保証するものではありません。

アップストリームスキルは [typesafe-ai/skills](https://github.com/typesafe-ai/skills) を固定リビジョンでベンダリングしており、MIT ライセンスを保持します。由来は [provenance](extensions/builtin/typesafe/AGENT.md) を参照。`--no-extensions` でディレクトリ探索を無効化できます。CLI が組み込み拡張を明示的に供給するため、明示的に `-e` で指定したパスと同様、組み込み拡張は読み込まれたままです。

## 設定とストレージ

デフォルトでは、エージェントの設定は `~/.catui/agents/<id>/`（ID は `default`）配下にあります。

| ファイル / ディレクトリ | 用途 |
| --- | --- |
| `auth.json` | プロバイダの認証情報 |
| `models.json` | カスタムモデルの定義 |
| `settings.json` | 設定と機能フラグ |
| `sessions/` | 保存された会話 |
| `extensions/` | ユーザ拡張 |

`--agent <id>` でエージェントを選択、`CATUI_CODING_AGENT_DIR` で設定ルートを差し替えられます。インライン設定は `/model` と `/persona`、プログラムからの組み込み方は `docs/sdk.md` を参照。

ローカル保存だからといって全機能がオフラインとは限りません。設定したプロバイダ、MCP サーバ、有効化された外部統合はネットワーク通信を行う可能性があります。

## 開発

```bash
npm ci
npm run build
npx tsx cli.ts
```

本リポジトリは npm workspaces を使い、3 つのプライベートランタイムライブラリと、公開されている protocol / memory 統合を管理します。`apps/mobile` は独自のツールチェーンを持ちます。`packages/soul-core` は停止中のスタンドアロンソースとして保持され、ルートワークスペースやアプリケーションビルドには含まれません。

| 場所 | 役割 |
| --- | --- |
| `cli.ts`, `main.ts` | CLI 起動とモード選択 |
| `core/runtime/` | 共有セッションファサードと分割されたランタイムオーナー |
| `core/lib/{ai,agent-core,tui}/` | プライベートのモデル / 実行ループ / ターミナルライブラリ |
| `core/platform/` | 設定 / プロセス / ユーティリティのプリミティブ |
| `modes/` | Interactive / Print / RPC / ACP / Remote インターフェース |
| `extensions/` | デフォルト / オプトイン製品機能 |
| `packages/{protocol,mem-core}/` | 公開 protocol / memory 統合 |
| `test/`, `tests/` | 回帰テストおよびキャラクタリゼーションテスト |
| `.dev-docs/`, `llm-wiki/` | アーキテクチャ判断と自動生成されたコードナビゲーション |

`AgentSession` が公開ファサードを保ちます。モデル変更、ライフサイクル、コンパクション、キュー、発生順、トレース永続化、統計、リソース探索にはそれぞれ名前付きオーナーがいます。[ランタイムマップ](core/runtime/AGENT.md) から始めてください。

挙動を変える前に [AGENTS.md](AGENTS.md) と [feature workflow](.dev-docs/feature-workflow.md) に従ってください。必要なチェック：

```bash
npm run verify:dip
npm run verify:quality
npm run verify:package-boundary
npm run build
npx tsc --noEmit
npm test
```

個別のスクリプトは `package.json` に列挙されています。任意の統合チェックはプロバイダ認証情報などを必要とすることがあります。ビルドと公開は別工程です。リリース前に[コントリビューションガイド](CONTRIBUTING.md) を確認してください。

## ライセンス

[GPL-3.0](LICENSE)。ベンダリングされたコンポーネントはそれぞれのライセンス表記を保持します。
