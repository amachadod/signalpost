# Media

Put your videos and photos here (.mp4, .mov, .jpg, .png, .webp) and refer to them in plan.md by name, like `media/teaser.mp4`.

GitHub takes files up to 100 MB (25 MB through the website). For bigger videos, upload them somewhere with a public HTTPS link and list them in `media/_info.json`:

```json
{
  "https://cdn.your-site.example/launch-trailer.mp4": { "kind": "video", "width": 1080, "height": 1920, "duration": 34 }
}
```

Signalpost measures the files in this folder itself (size, length, vertical or horizontal) so it can check each network's rules. Files starting with `_` are ignored.
