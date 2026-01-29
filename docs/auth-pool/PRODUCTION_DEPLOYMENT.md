# Production Deployment Guide

Complete guide for deploying Claude Authentication Pool Manager to production.

---

## Pre-Deployment Checklist

### Code Quality
- [x] All 198 tests passing
- [x] Zero console.log statements (structured logging only)
- [x] No memory leaks (timer cleanup implemented)
- [x] Security validations in place
- [x] Input sanitization enabled

### Configuration
- [ ] `config/auth-pool.json` created with production values
- [ ] Webhook URLs use HTTPS
- [ ] Config paths validated (no directory traversal)
- [ ] Email addresses validated
- [ ] Weekly budgets set correctly

### Infrastructure
- [ ] Monitoring dashboard configured
- [ ] Sentry DSN configured (optional)
- [ ] Log aggregation enabled
- [ ] Alerting rules set up

---

## Environment Variables

```bash
# Required
NODE_ENV=production

# Optional - Logging
LOG_LEVEL=info                           # debug|info|warn|error
SENTRY_DSN=https://...                   # Optional Sentry integration

# Optional - Auth Pool
AUTH_POOL_CONFIG=config/auth-pool.json   # Config file path
WEEKLY_BUDGET=456                        # Override budget (per subscription)
```

---

## Configuration Template

### `config/auth-pool.json`

```json
{
  "subscriptions": [
    {
      "id": "prod-sub1",
      "email": "team+sub1@company.com",
      "type": "claude-pro",
      "configDir": "~/.claude-prod-sub1",
      "weeklyBudget": 456,
      "maxClientsPerSub": 15
    },
    {
      "id": "prod-sub2",
      "email": "team+sub2@company.com",
      "type": "claude-pro",
      "configDir": "~/.claude-prod-sub2",
      "weeklyBudget": 456,
      "maxClientsPerSub": 15
    },
    {
      "id": "prod-sub3",
      "email": "team+sub3@company.com",
      "type": "claude-pro",
      "configDir": "~/.claude-prod-sub3",
      "weeklyBudget": 456,
      "maxClientsPerSub": 15
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
        "channels": ["webhook"],
        "enabled": true
      },
      {
        "type": "usage_threshold",
        "threshold": 0.9,
        "channels": ["webhook"],
        "enabled": true
      },
      {
        "type": "failover",
        "channels": ["webhook"],
        "enabled": true
      },
      {
        "type": "rotation",
        "channels": ["log"],
        "enabled": false
      }
    ],
    "webhookUrl": "https://your-webhook-endpoint.company.com/notify"
  }
}
```

---

## Deployment Steps

### Step 1: Staging Validation

```bash
# 1. Deploy to staging
npm run build
npm run deploy:staging

# 2. Run QA scenarios
# See QA_TEST_SCENARIOS.md

# 3. Run load test
artillery run load-test.yaml

# 4. Monitor for 24 hours
# Check metrics, logs, errors
```

### Step 2: Production Deployment (Blue-Green)

```bash
# 1. Deploy to blue environment (inactive)
npm run deploy:blue

# 2. Warm up (send test traffic)
curl https://api-blue.company.com/health

# 3. Switch traffic (10% → 50% → 100%)
# Use load balancer configuration

# 4. Monitor metrics
# Watch error rates, latency, allocation success

# 5. If successful, decommission green
# If issues, rollback to green
```

### Step 3: Gradual Rollout Plan

**Week 1: 10% Traffic**
- Monitor allocation success rate
- Check for errors in logs
- Verify rebalancing works
- Measure performance impact

**Week 2: 50% Traffic**
- Validate cost distribution
- Check webhook notifications
- Monitor memory usage
- Verify no memory leaks

**Week 3: 100% Traffic**
- Full production load
- All features enabled
- 24/7 monitoring

---

## Monitoring & Alerts

### Key Metrics

| Metric | Target | Alert Threshold |
|--------|--------|-----------------|
| Allocation Success Rate | >95% | <90% |
| Average Health Score | >70 | <50 |
| Rebalancing Frequency | Every 5-6 min | <1 per hour |
| Failover Rate | <5% | >10% |
| Response Time (p95) | <500ms | >1000ms |
| Memory Usage | <500 MB | >1 GB |
| Error Rate | <0.1% | >1% |

### Alert Rules

**Critical Alerts** (PagerDuty):
- All subscriptions exhausted (100% fallback)
- Error rate >5%
- Memory leak detected (growing >10% per hour)
- Auth pool initialization failed

**Warning Alerts** (Slack):
- Allocation success rate <95%
- Average health score <50
- Webhook delivery failures
- Rebalancing not occurring

**Info Alerts** (Email):
- Weekly budget 80% threshold crossed
- New subscription added
- Config reloaded

### Monitoring Dashboard

**Grafana Dashboard Panels**:

1. **Allocation Metrics**
   - Success rate (line chart)
   - Subscription distribution (pie chart)
   - Fallback usage (bar chart)

2. **Health Scores**
   - Per-subscription health (gauge)
   - Average pool health (line chart)
   - Status distribution (bar chart)

3. **Cost Tracking**
   - Weekly usage per subscription (stacked area)
   - Projected end-of-week cost (line chart)
   - Cost distribution (pie chart)

4. **Performance**
   - Response time percentiles (line chart)
   - Allocation latency (histogram)
   - Rebalancing duration (line chart)

5. **System Health**
   - Memory usage (line chart)
   - CPU usage (line chart)
   - Error rate (line chart)

---

## Logging Configuration

### Log Levels

**Production**: `LOG_LEVEL=info`
- Info: Allocations, deallocations, rebalancing
- Warn: Threshold crossings, validation failures
- Error: Failures, exceptions

**Debug**: `LOG_LEVEL=debug`
- Use only for troubleshooting
- High volume (not recommended for production)

### Log Aggregation

**Recommended**: Use structured logging with JSON format

```bash
# Enable JSON logging
export LOG_FORMAT=json

# Example log entry
{
  "timestamp": "2026-01-28T18:30:00.000Z",
  "level": "INFO",
  "module": "AllocationBalancer",
  "message": "Allocated session",
  "context": {
    "clientId": "client-123",
    "subscriptionId": "prod-sub2"
  }
}
```

**Tools**: Elasticsearch, Splunk, Datadog, CloudWatch

---

## Security Hardening

### Production Checklist

- [x] Webhook URLs validated (HTTPS only)
- [x] Config paths validated (no traversal)
- [x] Subscription IDs sanitized
- [ ] Rate limiting configured
- [ ] API authentication enabled
- [ ] SSL/TLS certificates valid
- [ ] Credentials rotated
- [ ] Access logs enabled

### Secrets Management

**DO NOT**:
- ❌ Commit credentials to git
- ❌ Store API keys in config files
- ❌ Use same credentials across environments

**DO**:
- ✅ Use environment variables
- ✅ Use secret management (Vault, AWS Secrets Manager)
- ✅ Rotate credentials quarterly
- ✅ Use different credentials per environment

---

## Disaster Recovery

### Backup Strategy

**Config Backups**:
- Daily backup of `config/auth-pool.json`
- Version control all config changes
- Test restore procedure monthly

**State Backups** (if using persistent storage):
- Hourly snapshots of subscription state
- 7-day retention
- Cross-region replication

### Rollback Plan

**Scenario: Critical Bug Detected**

1. **Immediate**: Switch traffic back to previous version (5 minutes)
2. **Investigation**: Analyze logs, identify root cause (1 hour)
3. **Fix**: Deploy hotfix to staging, validate (2 hours)
4. **Deploy**: Gradual rollout of fix (2 hours)

**Scenario: Memory Leak Detected**

1. **Mitigation**: Increase memory limits temporarily
2. **Restart**: Rolling restart of instances
3. **Investigation**: Analyze heap dumps
4. **Fix**: Deploy memory leak fix

**Scenario: All Subscriptions Exhausted**

1. **Immediate**: Verify fallback API working
2. **Add Capacity**: Provision additional subscriptions
3. **Adjust Thresholds**: Temporarily lower budget threshold
4. **Notify**: Alert team of cost overrun

---

## Performance Tuning

### Optimization Checklist

**Allocation Performance**:
- Cache subscription state (already implemented)
- Parallel health calculation (not needed - fast enough)
- Index optimization (already optimized)

**Rebalancing Performance**:
- Limit clients moved per cycle (default: 3)
- Increase interval if overhead too high
- Skip rebalancing if load low

**Memory Optimization**:
- Session cleanup: Remove stale sessions daily
- Usage record retention: Keep 7 days only
- Cache size limits: Already bounded by subscription count

### Load Testing

**Tool**: Artillery

```yaml
# load-test.yaml
config:
  target: "https://api.company.com"
  phases:
    - duration: 60
      arrivalRate: 10
      name: "Warm up"
    - duration: 300
      arrivalRate: 50
      name: "Sustained load"
    - duration: 120
      arrivalRate: 100
      name: "Spike"

scenarios:
  - name: "Chat completion"
    flow:
      - post:
          url: "/v1/chat/completions"
          json:
            messages:
              - role: "user"
                content: "Hello"
            session_id: "{{ $randomString() }}"
```

**Run**: `artillery run load-test.yaml`

**Success Criteria**:
- Response time p95 < 1 second
- Error rate < 0.1%
- No memory leaks
- Allocation success rate > 95%

---

## Operational Procedures

### Daily Tasks

- Review allocation success rate
- Check for errors in logs
- Verify rebalancing occurring
- Monitor weekly budget usage

### Weekly Tasks

- Review cost distribution
- Check for anomalies
- Analyze webhook deliveries
- Update team on status

### Monthly Tasks

- Review and adjust thresholds
- Rotate credentials
- Test backup restore
- Update documentation
- Performance review

---

## Troubleshooting Guide

### High Failover Rate (>10%)

**Symptoms**: Many requests using fallback API

**Diagnosis**:
```bash
curl https://api.company.com/debug/auth-pool | jq '.status[] | select(.status == "limited")'
```

**Solutions**:
- Add more subscriptions
- Increase weekly budget
- Lower budget threshold temporarily
- Investigate unusual usage spike

### Memory Growing Over Time

**Symptoms**: Memory usage increasing steadily

**Diagnosis**:
```bash
# Check memory usage
curl https://api.company.com/debug/memory

# Check session count
curl https://api.company.com/debug/auth-pool | jq '[.status[].assignedClients | length] | add'
```

**Solutions**:
- Verify sessions being deallocated
- Check for timer cleanup (already implemented)
- Restart instances if leak confirmed
- Deploy memory leak fix

### Rebalancing Not Occurring

**Symptoms**: Cost imbalance persists

**Diagnosis**: Check logs for `Rebalancing needed`

**Solutions**:
- Verify rebalancing enabled in config
- Lower cost gap threshold
- Check for idle clients (only idle moved)
- Verify destination has capacity

---

## Post-Deployment Validation

### Smoke Tests (First 1 Hour)

- [ ] Health check passes: `curl /health`
- [ ] Debug endpoint works: `curl /debug/auth-pool`
- [ ] Allocation succeeds: Send test request
- [ ] Logging works: Check log aggregation
- [ ] Metrics visible: Check dashboard

### 24-Hour Validation

- [ ] No critical errors
- [ ] Allocation success rate >95%
- [ ] Rebalancing occurring every 5-6 minutes
- [ ] Memory stable (no leaks)
- [ ] Webhooks delivered
- [ ] Cost distribution balanced

### Week 1 Review

- [ ] Performance targets met
- [ ] Cost savings achieved
- [ ] Zero incidents
- [ ] QA scenarios passing
- [ ] Team trained on operations

---

## Success Criteria

✅ **Deployment Successful** if:
- All smoke tests pass
- 24-hour validation complete
- No rollbacks required
- Performance targets met
- Cost optimized

✅ **Production Ready** if:
- Week 1 review passed
- Monitoring configured
- Alerts validated
- Team trained
- Documentation complete

---

## Support & Escalation

**Level 1 (Operations)**:
- Monitor dashboards
- Review logs
- Execute runbooks
- Restart if needed

**Level 2 (Engineering)**:
- Investigate errors
- Analyze performance issues
- Deploy hotfixes
- Adjust configuration

**Level 3 (Architecture)**:
- Design changes
- Capacity planning
- Architecture review
- Major incident response

**Contact**: See internal wiki for on-call schedule
