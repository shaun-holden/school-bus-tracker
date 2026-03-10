import { Resend } from 'resend';

function getResendClient() {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error('RESEND_API_KEY environment variable is not set');
  }
  const fromEmail = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';
  return {
    client: new Resend(apiKey),
    fromEmail,
  };
}

export async function sendPasswordResetEmail(toEmail: string, resetToken: string, resetUrl: string) {
  try {
    console.log('Attempting to send password reset email to:', toEmail);
    const { client, fromEmail } = getResendClient();

    const result = await client.emails.send({
      from: fromEmail,
      to: toEmail,
      subject: 'Reset Your Password - SchoolBus Tracker',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #f97316;">SchoolBus Tracker</h2>
          <p>You requested to reset your password. Click the link below to set a new password:</p>
          <p style="margin: 24px 0;">
            <a href="${resetUrl}" style="background-color: #f97316; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
              Reset Password
            </a>
          </p>
          <p style="color: #666; font-size: 14px;">
            This link will expire in 1 hour. If you didn't request this, you can safely ignore this email.
          </p>
          <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;" />
          <p style="color: #999; font-size: 12px;">
            SchoolBus Tracker - Safe transportation for your children
          </p>
        </div>
      `
    });

    console.log('Email send result:', JSON.stringify(result));

    if (result.error) {
      console.error('Resend API error:', result.error);
      return { success: false, error: result.error };
    }

    return { success: true, data: result };
  } catch (error) {
    console.error('Failed to send password reset email:', error);
    return { success: false, error };
  }
}

export async function sendNewBusinessSignupNotification(
  businessName: string,
  contactEmail: string,
  contactName: string,
  selectedPlan: string,
  phone?: string
) {
  const ADMIN_EMAIL = 'deshaun@tntgym.org';

  const planNames: Record<string, string> = {
    'starter': 'Starter ($49/month)',
    'professional': 'Professional ($99/month)',
    'enterprise': 'Enterprise ($249/month)',
    'pending_selection': 'Plan Not Yet Selected',
  };

  try {
    console.log('Sending new business signup notification to:', ADMIN_EMAIL);
    const { client, fromEmail } = getResendClient();

    const result = await client.emails.send({
      from: fromEmail,
      to: ADMIN_EMAIL,
      subject: `New Business Signup: ${businessName} - ${planNames[selectedPlan] || selectedPlan}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #3b82f6;">New Business Registration</h2>
          <p style="font-size: 16px; color: #333;">A new business has registered and is awaiting your approval.</p>

          <div style="background-color: #f3f4f6; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <h3 style="margin-top: 0; color: #1f2937;">Business Details</h3>
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="padding: 8px 0; color: #6b7280; width: 140px;">Company Name:</td>
                <td style="padding: 8px 0; color: #111827; font-weight: 600;">${businessName}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #6b7280;">Contact Name:</td>
                <td style="padding: 8px 0; color: #111827;">${contactName}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #6b7280;">Email:</td>
                <td style="padding: 8px 0; color: #111827;">${contactEmail}</td>
              </tr>
              ${phone ? `
              <tr>
                <td style="padding: 8px 0; color: #6b7280;">Phone:</td>
                <td style="padding: 8px 0; color: #111827;">${phone}</td>
              </tr>
              ` : ''}
              <tr>
                <td style="padding: 8px 0; color: #6b7280;">Selected Plan:</td>
                <td style="padding: 8px 0; color: #3b82f6; font-weight: 600;">${planNames[selectedPlan] || selectedPlan}</td>
              </tr>
            </table>
          </div>

          <p style="color: #666;">Log in to the Master Admin Dashboard to review and approve this application.</p>

          <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;" />
          <p style="color: #999; font-size: 12px;">
            SchoolBus Tracker - Platform Admin Notification
          </p>
        </div>
      `
    });

    console.log('Notification email send result:', JSON.stringify(result));

    if (result.error) {
      console.error('Resend API error:', result.error);
      return { success: false, error: result.error };
    }

    return { success: true, data: result };
  } catch (error) {
    console.error('Failed to send new business notification email:', error);
    return { success: false, error };
  }
}

export async function sendDriverInvitationEmail(
  toEmail: string,
  driverName: string,
  companyName: string,
  setupUrl: string
) {
  try {
    console.log('Attempting to send driver invitation email to:', toEmail);
    const { client, fromEmail } = getResendClient();

    const result = await client.emails.send({
      from: fromEmail,
      to: toEmail,
      subject: `Welcome to ${companyName} - Set Up Your Driver Account`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #f97316;">Welcome to SchoolBus Tracker!</h2>
          <p>Hello ${driverName},</p>
          <p>You have been added as a driver for <strong>${companyName}</strong>. To access your driver dashboard, please set up your password by clicking the button below:</p>
          <p style="margin: 24px 0;">
            <a href="${setupUrl}" style="background-color: #f97316; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
              Set Up Your Password
            </a>
          </p>
          <p style="color: #666; font-size: 14px;">
            This link will expire in 24 hours. If you didn't expect this invitation, you can safely ignore this email.
          </p>
          <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;" />
          <p style="color: #999; font-size: 12px;">
            SchoolBus Tracker - Safe transportation for your children
          </p>
        </div>
      `
    });

    console.log('Driver invitation email send result:', JSON.stringify(result));

    if (result.error) {
      console.error('Resend API error:', result.error);
      return { success: false, error: result.error };
    }

    return { success: true, data: result };
  } catch (error) {
    console.error('Failed to send driver invitation email:', error);
    return { success: false, error };
  }
}

export async function sendEmployeeInvitationEmail(
  toEmail: string,
  employeeName: string,
  role: string,
  companyName: string,
  setupUrl: string
) {
  try {
    const { client, fromEmail } = getResendClient();
    const roleLabel = role === 'admin' ? 'Administrator' : 'Driver';

    const result = await client.emails.send({
      from: fromEmail,
      to: toEmail,
      subject: `Welcome to ${companyName} - Set Up Your ${roleLabel} Account`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #f97316;">Welcome to SchoolBus Tracker!</h2>
          <p>Hello ${employeeName},</p>
          <p>You have been invited to join <strong>${companyName}</strong> as a <strong>${roleLabel}</strong>. Please set up your password to access your dashboard:</p>
          <p style="margin: 24px 0;">
            <a href="${setupUrl}" style="background-color: #f97316; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
              Set Up Your Password
            </a>
          </p>
          <p style="color: #666; font-size: 14px;">
            This link will expire in 24 hours. If you did not expect this invitation, you can safely ignore this email.
          </p>
          <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;" />
          <p style="color: #999; font-size: 12px;">
            SchoolBus Tracker - Safe transportation for your children
          </p>
        </div>
      `
    });

    if (result.error) {
      console.error('Resend API error:', result.error);
      return { success: false, error: result.error };
    }

    return { success: true, data: result };
  } catch (error) {
    console.error('Failed to send employee invitation email:', error);
    return { success: false, error };
  }
}
