# Claude Authentication Pool Manager

Intelligent management of multiple Claude Pro subscriptions with automatic usage tracking, load balancing, and cost optimization.

## Features

- **Real-time Usage Tracking**: Monitors usage from Claude CLI JSON output
- **5-Hour Billing Blocks**: Tracks usage in 5-hour UTC blocks (00:00, 05:00, 10:00, 15:00, 20:00)
- **Weekly Budget Management**: Rolling 7-day window budget tracking
- **Health-Based Selection**: Chooses subscriptions based on multi-factor health scores
- **Periodic Rebalancing**: Automatically moves idle clients to less-used subscriptions
- **Webhook Notifications**: Alerts for usage thresholds, failovers, and rotations
- **Safeguards**: Prevents overloading subscriptions with client count and budget limits

## Quick Start

### 1. Configure Subscriptions

Create `config/auth-pool.json`:

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
  }
}
```

### 2. Initialize Modules

```typescript
import {
  SubscriptionManager,
  UsageTracker,
  SessionStore,
  AllocationBalancer,
  MemoryStore,
} from './lib/auth-pool';

// Load config
const config = JSON.parse(fs.readFileSync('config/auth-pool.json', 'utf8'));

// Initialize storage
const storage = new MemoryStore();

// Initialize managers
const subscriptionManager = new SubscriptionManager(storage, config);
const usageTracker = new UsageTracker(storage);
const sessionStore = new SessionStore(storage);
const allocationBalancer = new AllocationBalancer(
  subscriptionManager,
  sessionStore,
  config
);

// Initialize subscriptions
await subscriptionManager.initialize();
```

### 3. Allocate Client to Subscription

```typescript
// Allocate session
const result = await allocationBalancer.allocateSession({
  clientId: 'client1',
  sessionId: 'test-session',
  estimatedTokens: 10000,
  priority: 'normal',
});

if (result.type === 'subscription') {
  console.log(`Allocated to subscription: ${result.subscriptionId}`);
  console.log(`Config dir: ${result.configDir}`);
} else {
  console.log('Using fallback API');
}
```

### 4. Record Usage

```typescript
// After Claude CLI execution
const claudeCliResponse = {
  result: 'Hello!',
  session_id: 'ses_123',
  duration_ms: 5000,
  total_cost_usd: 0.15,
  usage: {
    input_tokens: 1000,
    output_tokens: 500,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  },
  uuid: 'uuid_123',
  is_error: false,
};

// Record usage
await usageTracker.recordUsage(claudeCliResponse, result.subscriptionId);
```

### 5. Periodic Rebalancing

```typescript
// Run every 5 minutes
setInterval(async () => {
  const result = await allocationBalancer.rebalance();

  if (result.balancingNeeded) {
    console.log(`Moved ${result.clientsMoved} clients from ${result.fromSubscription} to ${result.toSubscription}`);
  }
}, config.rebalancing.intervalSeconds * 1000);
```

## Architecture

### Core Modules

1. **SubscriptionManager**: CRUD operations for subscriptions
2. **UsageTracker**: Records usage from Claude CLI JSON output
3. **SessionStore**: Manages client session → subscription mappings
4. **AllocationBalancer**: Subscription selection and periodic rebalancing
5. **NotificationManager**: Webhook notifications for events
6. **HealthCalculator**: Calculates multi-factor health scores

### Data Flow

```
Claude CLI Response
  ↓
UsageTracker.recordUsage()
  ↓
Update Subscription State (cost, tokens, burn rate)
  ↓
HealthCalculator.calculate() (weekly usage, block usage, clients, burn rate)
  ↓
AllocationBalancer.selectSubscription() (highest health score)
  ↓
Periodic Rebalancing (every 5 minutes)
```

### Health Score Algorithm

Health score (0-100, higher = better):
- **Weekly Usage** (50% weight): Lower usage = higher score
- **Block Usage** (30% weight): Lower block cost = higher score
- **Client Count** (5 points per client): Fewer clients = higher score
- **Burn Rate** (penalty for high burn): Lower burn rate = higher score
- **Idle Bonus** (+10): No active block = +10 points (clamped to 100 max)

### Safeguards

Subscriptions are excluded from allocation if:
- Status is `limited` or `cooldown`
- Weekly usage ≥ 85% of budget (configurable)
- Assigned clients ≥ max clients per subscription
- Projected block cost exceeds safe threshold

## Data Models

### Subscription

```typescript
interface Subscription {
  id: string;
  email: string;
  type: 'claude-pro' | 'claude-max' | 'api';
  configDir: string;

  // 5-hour block tracking
  currentBlockId: string | null;
  currentBlockCost: number;
  blockStartTime: number | null;
  blockEndTime: number | null;

  // Weekly budget
  weeklyBudget: number;
  weeklyUsed: number;

  // Allocation
  assignedClients: string[];
  maxClientsPerSub: number;

  // Health
  healthScore: number;
  status: 'available' | 'approaching' | 'limited' | 'cooldown';

  // Burn rate
  burnRate: number;
  tokensPerMinute: number;

  // Metadata
  lastUsageUpdate: number;
  lastRequestTime: number;
  createdAt: number;
}
```

### ClientSession

```typescript
interface ClientSession {
  id: string;
  subscriptionId: string;
  allocatedAt: number;
  lastActivity: number;
  status: 'active' | 'idle' | 'stale';
  sessionCost: number;
  sessionTokens: number;
  requestCount: number;
  clientIp?: string;
  userAgent?: string;
}
```

### UsageRecord

```typescript
interface UsageRecord {
  subscriptionId: string;
  timestamp: number;
  blockId: string;
  costUSD: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
  modelUsage?: Array<{
    model: string;
    inputTokens: number;
    outputTokens: number;
    cost: number;
  }>;
  sessionId?: string;
  durationMs?: number;
  uuid?: string;
}
```

## Testing

### Run Unit Tests

```bash
bun test tests/auth-pool/unit/
```

### Run Integration Tests

```bash
bun test tests/auth-pool/integration/
```

### Run All Tests

```bash
bun test tests/auth-pool/
```

## Documentation

See `docs/auth-pool/` for comprehensive documentation:

- `README.md`: Documentation index
- `MODULE_ARCHITECTURE.md`: System design
- `DATA_MODELS.md`: Complete type definitions
- `PSEUDOCODE.md`: Implementation logic
- `TESTING_STRATEGY.md`: Test cases
- `INTEGRATION_PLAN.md`: Integration guide

## License

Same as anthropic-headless-api project.
