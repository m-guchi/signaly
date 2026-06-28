'use strict'

const APP_VERSION = '1.0.6'

const APP_CHANGELOG = [
  {
    version: '1.0.6',
    date: '2026-06-29',
    changes: [
      '本番デプロイ時に OAuth などアプリ設定を 1Password から .env へ同期',
    ],
  },
  {
    version: '1.0.5',
    date: '2026-06-29',
    changes: [
      'GitHub Actions デプロイを user systemd に切り替え、sudo 不要に',
    ],
  },
  {
    version: '1.0.4',
    date: '2026-06-29',
    changes: [
      'GitHub Actions デプロイ時の sudo パスワード要求を解消（restart-service.sh + sudoers）',
    ],
  },
  {
    version: '1.0.3',
    date: '2026-06-29',
    changes: [
      '初回デプロイ時にサーバー環境を自動セットアップするよう改善',
    ],
  },
  {
    version: '1.0.2',
    date: '2026-06-29',
    changes: [
      'アプリの安定性と更新反映の改善',
    ],
  },
  {
    version: '1.0.1',
    date: '2026-06-29',
    changes: [
      'アプリ更新時に最新の画面が反映されやすくなった',
    ],
  },
  {
    version: '1.0.0',
    date: '2026-06-29',
    changes: [
      '初の安定版（1.0）としてリリース',
      'チャンネルグループ・並び替え・名前変更・削除に対応',
      'チャンネル・グループごとの通知オン/オフ設定',
      'チャンネル URL の共有と、起動時に前回のチャンネルを復元',
      'Webhook マニュアルページと読み込み・エラー表示を追加',
    ],
  },
  {
    version: '0.2.10',
    date: '2026-06-29',
    changes: [
      '通知の時刻・日付表示を改善（時刻のみ右上、日付は区切り表示）',
    ],
  },
  {
    version: '0.2.1',
    date: '2026-06-29',
    changes: [
      'Discord Webhook 形式（content / embeds）の受信に対応',
    ],
  },
  {
    version: '0.2.0',
    date: '2026-06-29',
    changes: [
      'Web Push 対応（アプリ終了中もスマホに通知）',
      'Push 通知タップで該当チャンネルを開く',
    ],
  },
  {
    version: '0.1.0',
    date: '2026-06-28',
    changes: [
      'ウェブフック通知のリアルタイム受信と表示',
      'Discord 風の embed フィールド（インライン表示）対応',
      'デスクトップ通知（PWA）対応',
      'Google アカウントによるログイン',
    ],
  },
]
