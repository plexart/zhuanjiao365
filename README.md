# zhuanjiao365

https://plexart.github.io/zhuanjiao365/

## Prepare Data

1. Deskmate List
   Edit `data/partners.json` to provide the deskmate list.

2. Group List
   Edit `data/groups.json` to provide the group list.

3. User Fiddler to capture the response from zhuanjiao365 for the function `info_OrderAlbumList`
   Save the response to `data/response.json`

## Build

```
npm run build
```

## Sync Selected Photos

Sync your photo selections with the server:

```
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
3. Ask for your `SelectMID` and `Signer` (from the app)
4. Send requests to sync your selections
