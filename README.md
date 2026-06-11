# zhuanjiao365

https://plexart.github.io/zhuanjiao365/

## Prepare Data

1. Deskmate List
   Edit `data/partners.json` to provide the deskmate list.

2. Group List
   Edit `data/groups.json` to provide the group list.

## Configuration

Copy `.env.example` to `.env` and fill in your credentials:

```bash
cp .env.example .env
```

Edit `.env` with your values:

- `orderID` - Your order ID (e.g., `88888`)
- `editOrderAlbumInfoSigner` - Signer for the edit API (sync selections)
- `infoOrderAlbumListSigner` - Signer for the info API (download photo list)
- `selectMID` - Your selectMID for syncing selections

> **Note:** You only need to provide these values once. They will be saved to `.env` for future use.

## Download Photo List

Download the latest photo list from the server:

```bash
npm run download
```

This will fetch `response.json` and save it to `data/`.

## Build

```bash
npm run build
```

## Sync Selected Photos

Sync your photo selections with the server:

```bash
npm run sync
```

**Before running**, create `data/selected.json` with the photo IDs you want to select:

```json
{
  "selected": [12345678, 87654321]
}
```

The script will:
1. Compare `selected.json` with the current state in `response.json`
2. Show you which photos will be selected/deselected
3. Send requests to sync your selections using credentials from `.env`
