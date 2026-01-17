#!/bin/bash
curl -s -X POST http://localhost:3456/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "messages":[{"role":"user","content":"Generate a person with name and age"}],
    "json_schema":{
      "type":"object",
      "properties":{
        "name":{"type":"string"},
        "age":{"type":"integer"}
      },
      "required":["name","age"]
    }
  }'
