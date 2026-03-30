# WishLystit

## Discover by screenshot

The discover flow now supports image-first product discovery:

1. Send a screenshot to `POST /api/v1/items/discover`
2. Vision AI extracts clothing attributes
3. Backend builds a search query
4. Google Shopping is searched across many retailers
5. Results are sorted by lowest price

### Required environment variables

- `ANTHROPIC_API_KEY`
- `SERPAPI_API_KEY`

### Optional environment variables

- `ANTHROPIC_MODEL` (default: `claude-3-5-sonnet-20241022`)
- `DISCOVER_GOOGLE_SHOPPING_LOCATION` (example: `United States`)
- `DISCOVER_VISION_PROMPT` (override extraction prompt)

### Request example

`POST /api/v1/items/discover`

```json
{
  "imageBase64": "data:image/jpeg;base64,/9j/4AAQSk...",
  "limit": 20
}
```

You can send `imageUrl` instead of `imageBase64`.
