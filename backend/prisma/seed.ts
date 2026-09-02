/**
 * Seed script – creates initial branch, admin user, sample products and inventory lots
 * Run: npx tsx prisma/seed.ts
 */

import { PrismaClient, Role } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // Tax profiles
  const vat = await prisma.taxProfile.upsert({
    where: { code: 'VAT17' },
    update: {},
    create: {
      code: 'VAT17',
      name: 'VAT 17%',
      rate: 17,
      inclusive: false,
    },
  });

  await prisma.taxProfile.upsert({
    where: { code: 'GST5' },
    update: {},
    create: {
      code: 'GST5',
      name: 'GST 5%',
      rate: 5,
      inclusive: false,
    },
  });

  // Branches (currency + default tax)
  const branch = await prisma.branch.upsert({
    where: { code: 'HQ' },
    update: {},
    create: {
      code: 'HQ',
      name: 'Head Office / Main Store',
      address: '123 Main Street',
      phone: '+1-555-0100',
      currencyCode: 'USD',
      currencySymbol: '$',
      taxProfileId: vat.id,
    },
  });

  await prisma.branch.upsert({
    where: { code: 'BR02' },
    update: {},
    create: {
      code: 'BR02',
      name: 'Downtown Branch',
      address: '45 Market Avenue',
      phone: '+1-555-0200',
      currencyCode: 'PKR',
      currencySymbol: 'Rs',
      taxProfileId: vat.id,
    },
  });

  // Admin user
  const passwordHash = await bcrypt.hash('admin123', 12);
  const admin = await prisma.user.upsert({
    where: { email: 'admin@pos.local' },
    update: {},
    create: {
      email: 'admin@pos.local',
      passwordHash,
      firstName: 'System',
      lastName: 'Admin',
      role: Role.ADMIN,
      branchId: branch.id,
    },
  });

  // Cashier
  const cashierHash = await bcrypt.hash('cashier123', 12);
  await prisma.user.upsert({
    where: { email: 'cashier@pos.local' },
    update: {},
    create: {
      email: 'cashier@pos.local',
      passwordHash: cashierHash,
      firstName: 'John',
      lastName: 'Cashier',
      role: Role.CASHIER,
      branchId: branch.id,
    },
  });

  // Categories
  const beverages = await prisma.category.upsert({
    where: { id: 'seed-cat-beverages' },
    update: {},
    create: {
      id: 'seed-cat-beverages',
      name: 'Beverages',
      description: 'Drinks & soft drinks',
    },
  });

  const snacks = await prisma.category.upsert({
    where: { id: 'seed-cat-snacks' },
    update: {},
    create: {
      id: 'seed-cat-snacks',
      name: 'Snacks',
      description: 'Chips, biscuits, etc.',
    },
  });

  // Products
  const cola = await prisma.product.upsert({
    where: { sku: 'BEV-COLA-330' },
    update: {},
    create: {
      sku: 'BEV-COLA-330',
      barcode: '8901234567890',
      name: 'Cola 330ml',
      categoryId: beverages.id,
      unit: 'pcs',
      costPrice: 0.45,
      sellingPrice: 1.20,
      taxRate: 5,
      reorderLevel: 50,
      branchId: branch.id,
    },
  });

  const chips = await prisma.product.upsert({
    where: { sku: 'SNK-CHIPS-50' },
    update: {},
    create: {
      sku: 'SNK-CHIPS-50',
      barcode: '8901234567891',
      name: 'Potato Chips 50g',
      categoryId: snacks.id,
      unit: 'pcs',
      costPrice: 0.30,
      sellingPrice: 0.99,
      taxRate: 5,
      reorderLevel: 30,
      branchId: branch.id,
    },
  });

  // Supplier
  const supplier = await prisma.supplier.upsert({
    where: { code: 'SUP-001' },
    update: {},
    create: {
      code: 'SUP-001',
      name: 'Global Distributors Ltd',
      contactName: 'Alice Supplier',
      email: 'orders@globaldist.example',
      phone: '+1-555-0200',
      address: '45 Warehouse Road',
    },
  });

  // Sample customer
  await prisma.customer.upsert({
    where: { code: 'CUST-001' },
    update: {},
    create: {
      code: 'CUST-001',
      name: 'Walk-in Customer',
      phone: '',
      branchId: branch.id,
    },
  });

  // Initial FIFO lots (simulating two purchases at different costs)
  const existingLots = await prisma.inventoryLot.count({
    where: { productId: cola.id },
  });
  if (existingLots === 0) {
    await prisma.inventoryLot.createMany({
      data: [
        {
          productId: cola.id,
          branchId: branch.id,
          quantity: 100,
          originalQty: 100,
          unitCost: 0.4,
          receivedAt: new Date('2026-07-01'),
          lotNumber: 'LOT-COLA-001',
        },
        {
          productId: cola.id,
          branchId: branch.id,
          quantity: 80,
          originalQty: 80,
          unitCost: 0.48,
          receivedAt: new Date('2026-07-15'),
          lotNumber: 'LOT-COLA-002',
        },
        {
          productId: chips.id,
          branchId: branch.id,
          quantity: 150,
          originalQty: 150,
          unitCost: 0.28,
          receivedAt: new Date('2026-07-10'),
          lotNumber: 'LOT-CHIPS-001',
        },
      ],
    });
  }

  console.log('✅ Seed completed');
  console.log('   Admin:    admin@pos.local / admin123');
  console.log('   Cashier:  cashier@pos.local / cashier123');
  console.log(`   Branch:   ${branch.code} (${branch.id})`);
  console.log(`   Supplier: ${supplier.code}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
