import { getStripeSync, getUncachableStripeClient } from './stripeClient';
import { storage } from './storage';
import { db } from './db';
import { companies, PLAN_CONFIGS, PlanType } from '@shared/schema';
import { eq } from 'drizzle-orm';

// Map Stripe product metadata to plan types
function getPlanTypeFromMetadata(metadata: any): PlanType {
  const planType = metadata?.planType || metadata?.plan_type;
  if (planType === 'starter' || planType === 'professional' || planType === 'enterprise') {
    return planType;
  }
  return 'starter'; // Default to starter
}

function getPlanConfigForType(planType: PlanType) {
  return PLAN_CONFIGS[planType];
}

export class WebhookHandlers {
  static async processWebhook(payload: Buffer, signature: string): Promise<void> {
    if (!Buffer.isBuffer(payload)) {
      throw new Error(
        'STRIPE WEBHOOK ERROR: Payload must be a Buffer. ' +
        'Received type: ' + typeof payload + '. ' +
        'This usually means express.json() parsed the body before reaching this handler. ' +
        'FIX: Ensure webhook route is registered BEFORE app.use(express.json()).'
      );
    }

    const sync = await getStripeSync();
    await sync.processWebhook(payload, signature);

    const event = JSON.parse(payload.toString());
    await WebhookHandlers.handleCustomLogic(event);
  }

  private static async handleCustomLogic(event: any) {
    switch (event.type) {
      case 'checkout.session.completed':
        await WebhookHandlers.handleCheckoutCompleted(event.data.object);
        break;
      case 'customer.subscription.updated':
        await WebhookHandlers.handleSubscriptionUpdated(event.data.object);
        break;
      case 'customer.subscription.deleted':
        await WebhookHandlers.handleSubscriptionDeleted(event.data.object);
        break;
      case 'invoice.payment_failed':
        await WebhookHandlers.handlePaymentFailed(event.data.object);
        break;
      case 'invoice.paid':
        await WebhookHandlers.handleInvoicePaid(event.data.object);
        break;
    }
  }

  private static async handleCheckoutCompleted(session: any) {
    const customerId = session.customer;
    const subscriptionId = session.subscription;
    const companyId = session.metadata?.companyId;

    if (!companyId) {
      console.log('No companyId in checkout session metadata');
      return;
    }

    // Get plan type from subscription/product metadata
    let planType: PlanType = 'starter';
    try {
      const stripe = await getUncachableStripeClient();
      if (subscriptionId) {
        const subscription = await stripe.subscriptions.retrieve(subscriptionId, {
          expand: ['items.data.price.product'],
        });
        const product = subscription.items.data[0]?.price?.product as any;
        if (product?.metadata) {
          planType = getPlanTypeFromMetadata(product.metadata);
        }
      }
    } catch (err) {
      console.error('Error fetching subscription for plan type:', err);
    }

    const planConfig = getPlanConfigForType(planType);

    const updates: any = {
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscriptionId,
      billingStatus: 'active',
      planType,
      staffUserLimit: planConfig.staffUserLimit,
      parentUserLimit: planConfig.parentUserLimit,
      parentPortalEnabled: planConfig.parentPortalEnabled,
      gpsEnabled: planConfig.gpsEnabled,
      updatedAt: new Date(),
    };

    await db.update(companies).set(updates).where(eq(companies.id, companyId));
    console.log(`Updated company ${companyId} with Stripe subscription and plan: ${planType}`);
  }

  private static async handleSubscriptionUpdated(subscription: any) {
    const company = await storage.getCompanyByStripeSubscriptionId(subscription.id);
    if (!company) return;

    let billingStatus: 'none' | 'trialing' | 'active' | 'past_due' | 'canceled' | 'unpaid' = 'active';
    switch (subscription.status) {
      case 'trialing':
        billingStatus = 'trialing';
        break;
      case 'active':
        billingStatus = 'active';
        break;
      case 'past_due':
        billingStatus = 'past_due';
        break;
      case 'canceled':
        billingStatus = 'canceled';
        break;
      case 'unpaid':
        billingStatus = 'unpaid';
        break;
    }

    // Get plan type from subscription product metadata
    let planType: PlanType = company.planType as PlanType || 'starter';
    try {
      const stripe = await getUncachableStripeClient();
      const fullSubscription = await stripe.subscriptions.retrieve(subscription.id, {
        expand: ['items.data.price.product'],
      });
      const product = fullSubscription.items.data[0]?.price?.product as any;
      if (product?.metadata) {
        planType = getPlanTypeFromMetadata(product.metadata);
      }
    } catch (err) {
      console.error('Error fetching subscription for plan type:', err);
    }

    const planConfig = getPlanConfigForType(planType);

    await db.update(companies).set({
      billingStatus,
      planType,
      staffUserLimit: planConfig.staffUserLimit,
      parentUserLimit: planConfig.parentUserLimit,
      parentPortalEnabled: planConfig.parentPortalEnabled,
      gpsEnabled: planConfig.gpsEnabled,
      currentPeriodEnd: subscription.current_period_end ? new Date(subscription.current_period_end * 1000) : null,
      trialEndsAt: subscription.trial_end ? new Date(subscription.trial_end * 1000) : null,
      updatedAt: new Date(),
    }).where(eq(companies.id, company.id));
    
    console.log(`Updated company ${company.id} subscription with plan: ${planType}`);
  }

  private static async handleSubscriptionDeleted(subscription: any) {
    const company = await storage.getCompanyByStripeSubscriptionId(subscription.id);
    if (!company) return;

    await db.update(companies).set({
      billingStatus: 'canceled',
      updatedAt: new Date(),
    }).where(eq(companies.id, company.id));
  }

  private static async handlePaymentFailed(invoice: any) {
    const customerId = invoice.customer;
    const company = await storage.getCompanyByStripeCustomerId(customerId);
    if (!company) return;

    await db.update(companies).set({
      billingStatus: 'past_due',
      updatedAt: new Date(),
    }).where(eq(companies.id, company.id));
  }

  private static async handleInvoicePaid(invoice: any) {
    const customerId = invoice.customer;
    const company = await storage.getCompanyByStripeCustomerId(customerId);
    if (!company) return;

    await db.update(companies).set({
      billingStatus: 'active',
      updatedAt: new Date(),
    }).where(eq(companies.id, company.id));
  }
}
