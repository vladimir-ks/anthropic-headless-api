#!/bin/bash
curl -s -X POST http://localhost:3456/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"Say OK"}],"allowed_tools":["Read"]}'
