# Introduction

A simple service for generate a thumb from a image

## Deploy

### Production

```bash
sls deploy -s production --param="NOTIFY_API_URL=https://studio-api.vitruveo.xyz"
```

### Quality Assuarance

```bash
sls deploy -s qa --param="NOTIFY_API_URL=https://studio-api.vtru.dev"
```

### DEV

```bash
sls deploy -s dev --param="NOTIFY_API_URL=https://2f0c-200-52-31-148.ngrok-free.app"
```
