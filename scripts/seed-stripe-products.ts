/**
 * Seed script to create subscription products and prices in Stripe
 * 
 * Run with: npx tsx scripts/seed-stripe-products.ts
 * 
 * This creates the subscription plans for the multi-tenant SaaS platform.
 */

import { getUncachableStripeClient } from '../server/stripeClient';

interface PlanConfig {
  name: string;
  planType: 'starter' | 'professional' | 'enterprise';
  description: string;
  monthlyPrice: number; // in cents
  yearlyPrice: number; // in cents (discounted)
  features: string[];
  staffLimit: number | null; // null = unlimited
  parentLimit: number | null; // null = unlimited, 0 = not allowed
}

const PLANS: PlanConfig[] = [
  {
    name: 'Starter',
    planType: 'starter',
    description: 'Core fleet management for small operations. Admin and driver access only.',
    monthlyPrice: 4900, // $49/month
    yearlyPrice: 47000, // $470/year (~20% discount)
    features: [
      'Up to 3 staff users (admin + driver)',
      'Core admin functionality',
      'Driver check-in/check-out',
      'Basic reporting',
      'Email support',
    ],
    staffLimit: 3,
    parentLimit: 0, // No parent portal
  },
  {
    name: 'Professional',
    planType: 'professional',
    description: 'Full-featured solution with parent portal and GPS tracking.',
    monthlyPrice: 9900, // $99/month
    yearlyPrice: 95000, // $950/year (~20% discount)
    features: [
      'Up to 5 staff users (admin + driver)',
      'Unlimited parent accounts',
      'Parent portal & notifications',
      'Parent-to-child linking codes',
      'Real-time GPS tracking',
      'Parent-driver messaging',
      'Advanced reporting',
      'Priority support',
    ],
    staffLimit: 5,
    parentLimit: null, // Unlimited parents
  },
  {
    name: 'Enterprise',
    planType: 'enterprise',
    description: 'Unlimited capacity for large school districts.',
    monthlyPrice: 24900, // $249/month
    yearlyPrice: 239000, // $2,390/year (~20% discount)
    features: [
      'Unlimited staff users',
      'Unlimited parent accounts',
      'All Professional features',
      'Custom integrations',
      'Dedicated account manager',
      'SLA guarantee',
      '24/7 phone support',
      'Custom branding',
    ],
    staffLimit: null, // Unlimited
    parentLimit: null, // Unlimited
  },
];

async function seedStripeProducts() {
  console.log('Starting Stripe product seeding...\n');

  try {
    const stripe = await getUncachableStripeClient();

    for (const plan of PLANS) {
      console.log(`Creating product: ${plan.name}`);

      // Create the product with planType metadata
      const product = await stripe.products.create({
        name: plan.name,
        description: plan.description,
        metadata: {
          planType: plan.planType,
          features: plan.features.join(','),
          staffLimit: plan.staffLimit?.toString() || 'unlimited',
          parentLimit: plan.parentLimit === 0 ? 'none' : (plan.parentLimit?.toString() || 'unlimited'),
        },
      });

      console.log(`  Product created: ${product.id}`);

      // Create monthly price
      const monthlyPrice = await stripe.prices.create({
        product: product.id,
        unit_amount: plan.monthlyPrice,
        currency: 'usd',
        recurring: {
          interval: 'month',
        },
        metadata: {
          planType: 'monthly',
        },
      });

      console.log(`  Monthly price created: ${monthlyPrice.id} ($${plan.monthlyPrice / 100}/month)`);

      // Create yearly price
      const yearlyPrice = await stripe.prices.create({
        product: product.id,
        unit_amount: plan.yearlyPrice,
        currency: 'usd',
        recurring: {
          interval: 'year',
        },
        metadata: {
          planType: 'yearly',
        },
      });

      console.log(`  Yearly price created: ${yearlyPrice.id} ($${plan.yearlyPrice / 100}/year)`);
      console.log('');
    }

    console.log('Stripe products and prices seeded successfully!');
    console.log('\nYou can now use these prices in your checkout sessions.');

  } catch (error) {
    console.error('Error seeding Stripe products:', error);
    process.exit(1);
  }
}

seedStripeProducts();
