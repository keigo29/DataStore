# MD Workstation の開発メモ（AI・開発者向け）

- 返事・コメント・画面の文言は日本語（やさしい言葉）。
- こちらのデータを外部へ送らない（読み込むだけはよい）。お金のデータ（Cmd の Data/kakei.json）はテストでも外に出さない。テストは作りもののデータで。
- **正本はこのリポジトリ（keigo29/DataStore）だけ**。ほかの場所に写しを作って上書きコピーしない。
- 変える前に必ず `git pull --rebase`。ほかの人の変更を消さない（上書きコピー禁止）。

## 直すところ

- `app/app.js` は **作られたファイル**。直すのは `app/src/*.js`（タブごと。名前の順につなげて1つにする）→ `npm run build`
  - 00-core（データ・保存）／10-notes-bridge（PC のノート画面とのつなぎ・自動保存）／20-parts（部品）／30-home／31-todo／40-calendar／50-projects／60-notes／70-money／72-health（体重・睡眠・筋トレ）／75-graph／80-markdown（スマホの書く画面・キーのバー）／85-sync／90-wide（PC の並び）／95-shell（タブ・レール）／99-start
- 画面を変えたら `app/sw.js` の `VERSION` を1つ上げる（スマホが新しい版を取りに行くため）。新しいファイルは `FILES` にも足す
- Mac 版は `app/` をコピーして使う（`mac/scripts/copy-app.js`。`mac/app/` は作られたもので git に入れない）

## テスト（push の前に）

```bash
npm ci                      # はじめだけ
npm test                    # check ＋ 計算 ＋ Mac 版の中身 ＋ 画面（Chromium）
npm run test:electron       # Mac 版の画面（cd mac && npm ci が先。Linux は xvfb-run -a をつける）
```

- push すると GitHub Actions（`.github/workflows/test.yml`）で同じテストが流れる
- 画面のテストは `tests/e2e/`。GitHub は `mockGitHub()` でまねる（古い sha で書くと 409 を返す、本物と同じ動き）
