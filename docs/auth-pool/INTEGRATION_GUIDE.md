# Auth Pool Integration Guide

Complete guide for integrating the Claude Authentication Pool Manager with anthropic-headless-api.

## Architecture

```
Request Flow:
1. HTTP Request → API Gateway
2. Auth Pool Allocation (middleware)
3. Router selects backend based on allocation
4. Execute on selected Claude CLI backend
5. Record usage → Update subscription state
6. Periodic rebalancing (background job)
```

## Files to Modify

### 1. `src/index.ts` (Main Entry Point)

**Add at top:**
```typescript
import { initializeAuthPool } from './lib/auth-pool-integration';
import type { AuthPoolInstance } from './lib/auth-pool-integration';
```

**Add after app initialization:**
```typescript
// Initialize auth pool
let authPool: AuthPoolInstance | null = null;

try {
  authPool = await initializeAuthPool('config/auth-pool.json');
} catch (error) {
  console.error('Auth pool initialization failed:', error);
}
```

**Add middleware before routing:**
```typescript
app.post('/v1/chat/completions', async (req, res) => {
  // Existing validation...
  const body = req.body;

  // NEW: Auth pool allocation
  let accountContext = null;

  if (authPool && authPool.client.isEnabled()) {
    try {
      const allocation = await authPool.client.allocateAccount({
        sessionId: body.session_id,
        estimatedTokens: estimateTokens(body.messages), // Implement this helper
        priority: body.priority || 'normal',
      });

      if (allocation.type === 'subscription') {
        accountContext = {
          subscriptionId: allocation.subscriptionId,
          configDir: allocation.configDir,
        };

        console.log(`[AuthPool] Allocated ${body.session_id} to ${allocation.subscriptionId}`);
      } else {
        console.log(`[AuthPool] Using fallback: ${allocation.reason}`);
      }
    } catch (error) {
      console.error('[AuthPool] Allocation failed:', error);
    }
  }

  // Existing routing logic...
  const decision = await ctx.router.route(body, {
    explicitBackend: preferredBackend,
    allowFallback: true,
    accountContext, // NEW: Pass to router
  });

  // ... rest of existing code

  // NEW: Report usage after completion
  if (authPool && accountContext && result.usage) {
    await authPool.client.reportUsage({
      subscriptionId: accountContext.subscriptionId,
      cost: result.claude_metadata?.cost || 0,
      tokens: result.usage.total_tokens,
      sessionId: body.session_id,
    });
  }

  res.json(result);
});
```

**Helper function:**
```typescript
function estimateTokens(messages: any[]): number {
  // Rough estimate: 4 chars per token
  const totalChars = messages.reduce((sum, msg) => {
    return sum + (msg.content?.length || 0);
  }, 0);

  return Math.ceil(totalChars / 4);
}
```

### 2. `src/lib/router.ts` (Router)

**Add to RoutingOptions interface:**
```typescript
interface RoutingOptions {
  explicitBackend?: string;
  allowFallback?: boolean;
  accountContext?: {        // NEW
    subscriptionId: string;
    configDir: string;
  };
}
```

**Modify route method:**
```typescript
async route(request: ChatCompletionRequest, options: RoutingOptions): Promise<RoutingDecision> {
  // ... existing logic

  // NEW: Use account context to select backend
  if (options.accountContext && requiresTools) {
    const backendName = `claude-cli-${options.accountContext.subscriptionId}`;
    const backend = this.registry.getBackend(backendName);

    if (backend) {
      return {
        backend,
        reason: `Account ${options.accountContext.subscriptionId} allocated`,
        isFallback: false,
      };
    }
  }

  // ... rest of existing logic
}
```

### 3. `src/lib/backend-registry.ts` (Backend Registry)

**Add accountId field to BackendConfig:**
```typescript
interface BackendConfig {
  name: string;
  type: string;
  // ... existing fields
  accountId?: string;        // NEW: Links backend to auth pool subscription
  configDir?: string;        // NEW: For Claude CLI backends
}
```

### 4. `config/backends.json` (Backend Configuration)

**Add accountId to each backend:**
```json
{
  "backends": [
    {
      "name": "claude-cli-sub1",
      "type": "claude-cli",
      "configDir": "~/.claude-sub1",
      "accountId": "sub1",              // NEW
      "maxConcurrent": 10,
      "supportsTools": true
    },
    {
      "name": "claude-cli-sub2",
      "type": "claude-cli",
      "configDir": "~/.claude-sub2",
      "accountId": "sub2",              // NEW
      "maxConcurrent": 10,
      "supportsTools": true
    },
    {
      "name": "claude-cli-sub3",
      "type": "claude-cli",
      "configDir": "~/.claude-sub3",
      "accountId": "sub3",              // NEW
      "maxConcurrent": 10,
      "supportsTools": true
    }
  ]
}
```

### 5. `config/auth-pool.json` (NEW FILE)

Create auth pool configuration:
```json
{
  "subscriptions": [
    {
      "id": "sub1",
      "email": "user1@example.com",
      "type": "claude-pro",
      "configDir": "~/.claude-sub1",
      "weeklyBudget": 456
    },
    {
      "id": "sub2",
      "email": "user2@example.com",
      "type": "claude-pro",
      "configDir": "~/.claude-sub2",
      "weeklyBudget": 456
    },
    {
      "id": "sub3",
      "email": "user3@example.com",
      "type": "claude-pro",
      "configDir": "~/.claude-sub3",
      "weeklyBudget": 456
    }
  ],
  "maxClientsPerSubscription": 15,
  "weeklyBudgetThreshold": 0.85,
  "fallbackWhenExhausted": true,
  "rebalancing": {
    "enabled": true,
    "intervalSeconds": 300,
    "costGapThreshold": 5.0,
    "maxClientsToMovePerCycle": 3
  },
  "notifications": {
    "rules": [
      {
        "type": "usage_threshold",
        "threshold": 0.8,
        "channels": ["webhook", "log"],
        "enabled": true
      },
      {
        "type": "failover",
        "channels": ["webhook"],
        "enabled": true
      }
    ],
    "webhookUrl": "https://your-webhook-endpoint.com/notify"
  }
}
```

## Testing Integration

### Unit Test Integration

```bash
# Run all auth pool tests
bun test tests/auth-pool/

# Expected: 198 tests passing
```

### Manual Integration Test

1. Start API server with auth pool enabled
2. Send test request:
```bash
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role": "user", "content": "Hello"}],
    "session_id": "test-session"
  }'
```

3. Check logs for auth pool allocation:
```
[AuthPool] Allocated test-session to sub1
```

4. Send multiple requests to test load balancing
5. Wait 5 minutes to test periodic rebalancing

### Verify Health Scores

```typescript
// Add debug endpoint (development only)
app.get('/debug/auth-pool', async (req, res) => {
  if (!authPool) {
    return res.json({ error: 'Auth pool not initialized' });
  }

  const subscriptions = await authPool.subscriptionManager.getAllSubscriptions();

  const status = subscriptions.map(sub => ({
    id: sub.id,
    email: sub.email,
    weeklyUsed: sub.weeklyUsed,
    weeklyBudget: sub.weeklyBudget,
    currentBlockCost: sub.currentBlockCost,
    assignedClients: sub.assignedClients.length,
    healthScore: sub.healthScore,
    status: sub.status,
    burnRate: sub.burnRate,
  }));

  res.json({ status });
});
```

## Environment Variables

```bash
# Enable auth pool
AUTH_POOL_ENABLED=true

# Config path (default: config/auth-pool.json)
AUTH_POOL_CONFIG=config/auth-pool.json

# Weekly budget override (optional)
WEEKLY_BUDGET=500

# Disable rebalancing (optional)
AUTH_POOL_REBALANCING_ENABLED=false
```

## Monitoring

### Key Metrics

1. **Allocation Rate**: Subscriptions allocated vs fallbacks used
2. **Cost Distribution**: Usage spread across subscriptions
3. **Health Scores**: Average health score of pool
4. **Rebalancing Events**: Frequency and effectiveness
5. **Client Distribution**: Clients per subscription

### Webhooks

Configure webhook notifications in `config/auth-pool.json`:

**Payload Example:**
```json
{
  "type": "usage_threshold",
  "severity": "warning",
  "subscriptionId": "sub1",
  "message": "Subscription sub1 at 85% weekly budget",
  "data": {
    "weeklyUsed": 388,
    "weeklyBudget": 456,
    "weeklyPercent": "85.0",
    "burnRate": 5.2,
    "estimatedTimeUntilExhaustion": "12 hours"
  }
}
```

## Troubleshooting

### Auth Pool Not Initializing

**Check:**
- Config file exists at `config/auth-pool.json`
- Config is valid JSON
- At least one subscription configured
- Subscription config dirs exist

**Logs:**
```
[AuthPool] Config not found, auth pool disabled
[AuthPool] No subscriptions configured, auth pool disabled
```

### Allocations Always Fallback

**Check:**
- All subscriptions exceed weekly budget threshold (85%)
- All subscriptions at client capacity
- All subscriptions marked as 'limited' or 'cooldown'

**Debug:**
```bash
curl http://localhost:3000/debug/auth-pool
```

### Rebalancing Not Working

**Check:**
- `rebalancing.enabled` is true in config
- Cost gap between subscriptions exceeds threshold ($5)
- Idle clients exist to move
- Destination subscription has capacity

**Logs:**
```
[AllocationBalancer] Rebalancing needed: cost gap $10.00
[AllocationBalancer] Moved 2 clients from sub1 to sub2
```

### High Usage on One Subscription

**Causes:**
- Rebalancing disabled
- Cost gap below threshold
- All clients active (none idle to move)
- Other subscriptions at capacity

**Solution:**
- Lower `costGapThreshold` in config
- Increase rebalancing frequency
- Add more subscriptions to pool

## Performance Impact

### Overhead per Request

- **Allocation**: ~5-10ms (in-memory lookup)
- **Usage Recording**: ~2-5ms (async, non-blocking)
- **Total**: <15ms additional latency

### Memory Usage

- **Per Subscription**: ~1 KB
- **Per Session**: ~500 bytes
- **Per Usage Record**: ~200 bytes
- **Total (3 subs, 50 sessions, 1000 records)**: ~250 KB

### Periodic Jobs

- **Rebalancing**: Runs every 5 minutes, <100ms execution
- **Health Calculation**: On-demand during allocation, <5ms

## Security Considerations

1. **Config Dir Permissions**: Ensure Claude CLI config dirs are secure
2. **Webhook URLs**: Use HTTPS for webhook endpoints
3. **Credential Storage**: Never commit credentials to git
4. **API Keys**: Rotate regularly, use environment variables
5. **Rate Limiting**: Implement per-client rate limits

## Next Steps

1. **Test in Development**: Run integration tests
2. **Deploy to Staging**: Verify with real traffic
3. **Monitor Metrics**: Track allocation rates and health scores
4. **Tune Thresholds**: Adjust based on usage patterns
5. **Add Alerting**: Configure webhook notifications
6. **Scale Up**: Add more subscriptions as needed

## Support

- **Documentation**: `docs/auth-pool/README.md`
- **Source Code**: `src/lib/auth-pool/`
- **Tests**: `tests/auth-pool/`
- **Issues**: Report bugs to project maintainer
