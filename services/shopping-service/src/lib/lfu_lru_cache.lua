-- LFU/LRU Cache Implementation with Redis Lua Scripts
-- Provides atomic operations for cache management

-- KEYS[1] = sorted set key (for LRU) or pattern (for LFU)
-- ARGV[1] = command
-- ARGV[2] = user_id
-- ARGV[3] = cache_key
-- ARGV[4] = cache_type ('lfu' or 'lru')
-- ARGV[5] = ttl (seconds)
-- ARGV[6] = max_items (for eviction)

local command = ARGV[1]
local user_id = ARGV[2]
local cache_key = ARGV[3]
local cache_type = ARGV[4] or 'lfu'
local ttl = tonumber(ARGV[5]) or 86400
local max_items = tonumber(ARGV[6]) or 100

-- LFU (Least Frequently Used) - increment access count
if command == 'increment_lfu' then
  local access_key = 'cache:lfu:' .. user_id .. ':' .. cache_key
  local count = redis.call('INCR', access_key)
  if count == 1 then
    redis.call('EXPIRE', access_key, ttl)
  end
  return count
end

-- Get LFU access count
if command == 'get_lfu_count' then
  local access_key = 'cache:lfu:' .. user_id .. ':' .. cache_key
  return tonumber(redis.call('GET', access_key) or 0)
end

-- LRU (Least Recently Used) - update last access time
if command == 'update_lru' then
  local sorted_set_key = 'cache:lru:' .. user_id
  local now = redis.call('TIME')[1]
  redis.call('ZADD', sorted_set_key, now, cache_key)
  redis.call('EXPIRE', sorted_set_key, ttl)
  return now
end

-- Get LRU last access time
if command == 'get_lru_time' then
  local sorted_set_key = 'cache:lru:' .. user_id
  local score = redis.call('ZSCORE', sorted_set_key, cache_key)
  return tonumber(score or 0)
end

-- Evict LFU items (remove least frequently used)
if command == 'evict_lfu' then
  local pattern = cache_key -- pattern is passed as cache_key arg
  local keys = {}
  local cursor = "0"
  repeat
    local scan = redis.call('SCAN', cursor, 'MATCH', pattern, 'COUNT', 200)
    cursor = scan[1]
    for _, key in ipairs(scan[2]) do
      table.insert(keys, key)
    end
  until cursor == "0"
  if #keys <= max_items then
    return 0
  end
  
  -- Get counts for all keys
  local items = {}
  for i, key in ipairs(keys) do
    local count = tonumber(redis.call('GET', key) or 0)
    table.insert(items, {key = key, count = count})
  end
  
  -- Sort by count (ascending)
  table.sort(items, function(a, b) return a.count < b.count end)
  
  -- Remove lowest count items
  local removed = 0
  for i = 1, #items - max_items do
    redis.call('DEL', items[i].key)
    removed = removed + 1
  end
  
  return removed
end

-- Evict LRU items (remove least recently used)
if command == 'evict_lru' then
  local sorted_set_key = KEYS[1] -- sorted set key
  local count = redis.call('ZCARD', sorted_set_key)
  if count <= max_items then
    return 0
  end
  
  -- Remove oldest items (lowest scores)
  local removed = redis.call('ZREMRANGEBYRANK', sorted_set_key, 0, count - max_items - 1)
  return removed
end

-- Unknown command
return {err = 'Unknown command: ' .. command}
