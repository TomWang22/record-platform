#!/usr/bin/env node
/**
 * Test script to verify database connection on port 5434
 * Usage: POSTGRES_URL_SOCIAL="postgresql://postgres:postgres@localhost:5434/records" node scripts/test-db-connection.js
 */

const { Pool } = require('pg');
const { PrismaClient } = require('../generated/client');

const DB_URL = process.env.POSTGRES_URL_SOCIAL || 'postgresql://postgres:postgres@localhost:5434/records';

async function testPgConnection() {
  console.log('🔍 Testing pg (node-postgres) connection...');
  const pool = new Pool({ connectionString: DB_URL });
  
  try {
    const result = await pool.query('SELECT version(), current_database(), current_schema()');
    console.log('✅ pg connection successful!');
    console.log(`   Database: ${result.rows[0].current_database}`);
    console.log(`   Schema: ${result.rows[0].current_schema}`);
    console.log(`   Version: ${result.rows[0].version.split(',')[0]}`);
    
    // Test schema access
    const schemas = await pool.query(`
      SELECT schema_name 
      FROM information_schema.schemata 
      WHERE schema_name IN ('forum', 'messages')
      ORDER BY schema_name
    `);
    console.log(`   Available schemas: ${schemas.rows.map(r => r.schema_name).join(', ')}`);
    
    // Test table access
    const tables = await pool.query(`
      SELECT schemaname, tablename 
      FROM pg_tables 
      WHERE schemaname IN ('forum', 'messages')
      ORDER BY schemaname, tablename
      LIMIT 5
    `);
    console.log(`   Found ${tables.rows.length} tables in forum/messages schemas`);
    
    await pool.end();
    return true;
  } catch (error) {
    console.error('❌ pg connection failed:', error.message);
    await pool.end();
    return false;
  }
}

async function testPrismaConnection() {
  console.log('\n🔍 Testing Prisma connection...');
  const prisma = new PrismaClient({
    datasources: {
      db: {
        url: DB_URL,
      },
    },
  });
  
  try {
    // Test basic connection
    const result = await prisma.$queryRaw`SELECT 1 as test, current_database() as db`;
    console.log('✅ Prisma connection successful!');
    console.log(`   Database: ${result[0].db}`);
    
    // Test schema access
    const forumCount = await prisma.$queryRaw`SELECT COUNT(*) as count FROM forum.posts`;
    const messagesCount = await prisma.$queryRaw`SELECT COUNT(*) as count FROM messages.messages`;
    console.log(`   forum.posts: ${forumCount[0].count} rows`);
    console.log(`   messages.messages: ${messagesCount[0].count} rows`);
    
    // Test Prisma client models
    const postCount = await prisma.post.count();
    const messageCount = await prisma.message.count();
    console.log(`   Prisma Post model: ${postCount} posts`);
    console.log(`   Prisma Message model: ${messageCount} messages`);
    
    await prisma.$disconnect();
    return true;
  } catch (error) {
    console.error('❌ Prisma connection failed:', error.message);
    await prisma.$disconnect();
    return false;
  }
}

async function main() {
  console.log(`\n📊 Testing database connection to: ${DB_URL.replace(/:[^:@]+@/, ':****@')}\n`);
  
  const pgOk = await testPgConnection();
  const prismaOk = await testPrismaConnection();
  
  console.log('\n' + '='.repeat(50));
  if (pgOk && prismaOk) {
    console.log('✅ All database connection tests passed!');
    process.exit(0);
  } else {
    console.log('❌ Some tests failed');
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

