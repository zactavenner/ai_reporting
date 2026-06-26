import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

interface NotificationPayload {
  taskId: string;
  action: 'assigned' | 'updated' | 'due_reminder' | 'completed';
  recipientEmail?: string;
  recipientName?: string;
  clientId?: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const payload: NotificationPayload = await req.json();
    const { taskId, action, recipientEmail, recipientName, clientId } = payload;

    console.log(`Processing task notification: ${action} for task ${taskId}`);

    // Fetch the task details
    const { data: task, error: taskError } = await supabase
      .from('tasks')
      .select('*')
      .eq('id', taskId)
      .single();

    if (taskError || !task) {
      console.error('Task not found:', taskError);
      return new Response(
        JSON.stringify({ success: false, error: 'Task not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Determine which client's GHL API to use
    const targetClientId = clientId || task.client_id;
    
    if (!targetClientId) {
      console.log('No client associated with task, skipping GHL email');
      return new Response(
        JSON.stringify({ success: false, error: 'No client associated with task' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch the client with GHL credentials
    const { data: client, error: clientError } = await supabase
      .from('clients')
      .select('id, name, ghl_api_key, ghl_location_id')
      .eq('id', targetClientId)
      .single();

    if (clientError || !client) {
      console.error('Client not found:', clientError);
      return new Response(
        JSON.stringify({ success: false, error: 'Client not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!client.ghl_api_key || !client.ghl_location_id) {
      console.log('Client does not have GHL credentials configured');
      return new Response(
        JSON.stringify({ success: false, error: 'GHL credentials not configured for client' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Determine recipient email
    let emailTo = recipientEmail;
    
    // If assigned to agency member, get their email
    if (!emailTo && task.assigned_to) {
      const { data: member } = await supabase
        .from('agency_members')
        .select('email, name')
        .eq('id', task.assigned_to)
        .single();
      
      if (member) {
        emailTo = member.email;
      }
    }

    if (!emailTo) {
      console.log('No recipient email found, cannot send notification');
      return new Response(
        JSON.stringify({ success: false, error: 'No recipient email' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Respect client_team_members.notify_prefs matrix (event x channel).
    // Action → event name (matches the UI checkboxes in ClientTeamSection).
    const eventName =
      action === 'assigned' ? 'new_tasks'
      : action === 'due_reminder' ? 'overdue_tasks'
      : null;
    let smsTarget: string | null = null;
    let whatsappTarget: string | null = null;
    let emailEnabled = true;
    if (eventName) {
      const { data: tm } = await supabase
        .from('client_team_members')
        .select('phone, notify_prefs')
        .eq('client_id', targetClientId)
        .ilike('email', emailTo)
        .maybeSingle();
      const prefs = (tm as any)?.notify_prefs?.[eventName] || null;
      if (prefs) {
        emailEnabled = !!prefs.email;
        if (prefs.sms && (tm as any)?.phone) smsTarget = (tm as any).phone;
        if (prefs.whatsapp && (tm as any)?.phone) whatsappTarget = (tm as any).phone;
      }
    }

    // Fan out SMS / WhatsApp through their respective delivery functions.
    if (smsTarget) {
      supabase.functions.invoke('send-sms', {
        body: { to: smsTarget, message: `[${client.name}] ${task.title}` },
      }).catch((e) => console.warn('send-sms failed (non-fatal):', e?.message));
    }
    if (whatsappTarget) {
      supabase.functions.invoke('whatsapp-send', {
        body: { to: whatsappTarget, text: `[${client.name}] ${task.title}` },
      }).catch((e) => console.warn('whatsapp-send failed (non-fatal):', e?.message));
    }

    if (!emailEnabled) {
      console.log(`Email channel disabled in notify_prefs for ${emailTo} / event=${eventName}`);
      return new Response(
        JSON.stringify({ success: true, emailSent: false, smsQueued: !!smsTarget, whatsappQueued: !!whatsappTarget, reason: 'email_pref_disabled' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Build email content based on action
    const emailContent = buildEmailContent(task, action, client.name, recipientName);

    // Send email via GHL API (V2 endpoint)
    const ghlEmailResult = await sendGHLEmail(
      client.ghl_api_key,
      client.ghl_location_id,
      emailTo,
      emailContent.subject,
      emailContent.body
    );

    if (ghlEmailResult.success) {
      console.log(`Email sent successfully to ${emailTo}`);
      
      // Log the notification in task history
      await supabase
        .from('task_history')
        .insert({
          task_id: taskId,
          action: `notification_sent_${action}`,
          new_value: emailTo,
          changed_by: 'system',
        });

      return new Response(
        JSON.stringify({ success: true, emailSent: true, recipient: emailTo }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    } else {
      console.error('GHL email failed:', ghlEmailResult.error);
      return new Response(
        JSON.stringify({ success: false, error: ghlEmailResult.error }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

  } catch (error: unknown) {
    console.error('Notification error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

function buildEmailContent(task: any, action: string, clientName: string, recipientName?: string): { subject: string; body: string } {
  const greeting = recipientName ? `Hi ${recipientName},` : 'Hi,';
  const taskLink = `Task: ${task.title}`;
  const dueDateInfo = task.due_date ? `Due: ${new Date(task.due_date).toLocaleDateString()}` : '';
  
  switch (action) {
    case 'assigned':
      return {
        subject: `[${clientName}] New Task Assigned: ${task.title}`,
        body: `${greeting}

You have been assigned a new task for ${clientName}.

${taskLink}
${task.description || ''}
${dueDateInfo}
Priority: ${task.priority}
Stage: ${task.stage}

Please log in to view and manage this task.

Best regards,
Funding Sonar`
      };
    
    case 'updated':
      return {
        subject: `[${clientName}] Task Updated: ${task.title}`,
        body: `${greeting}

A task you're assigned to has been updated.

${taskLink}
${task.description || ''}
${dueDateInfo}
Status: ${task.status}
Stage: ${task.stage}

Please log in to view the latest changes.

Best regards,
Funding Sonar`
      };
    
    case 'due_reminder':
      return {
        subject: `[${clientName}] Task Due Soon: ${task.title}`,
        body: `${greeting}

This is a reminder that the following task is due soon:

${taskLink}
${task.description || ''}
${dueDateInfo}

Please ensure this task is completed on time.

Best regards,
Funding Sonar`
      };
    
    case 'completed':
      return {
        subject: `[${clientName}] Task Completed: ${task.title}`,
        body: `${greeting}

A task has been marked as completed.

${taskLink}
${task.description || ''}
Completed: ${new Date().toLocaleDateString()}

Best regards,
Funding Sonar`
      };
    
    default:
      return {
        subject: `[${clientName}] Task Notification: ${task.title}`,
        body: `${greeting}

You have a notification regarding the following task:

${taskLink}
${task.description || ''}

Best regards,
Funding Sonar`
      };
  }
}

async function sendGHLEmail(
  apiKey: string,
  locationId: string,
  toEmail: string,
  subject: string,
  body: string
): Promise<{ success: boolean; error?: string }> {
  try {
    // GHL V2 API for sending emails
    // First, we need to find or create a contact for the recipient
    const baseUrl = 'https://services.leadconnectorhq.com';
    
    const headers = {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Version': '2021-07-28',
    };

    // Search for contact by email using V2 API
    let contactId: string | null = null;
    
    try {
      const searchResponse = await fetch(
        `${baseUrl}/contacts/?locationId=${locationId}&query=${encodeURIComponent(toEmail)}&limit=1`,
        { method: 'GET', headers }
      );
      
      if (searchResponse.ok) {
        const searchData = await searchResponse.json();
        if (searchData.contacts && searchData.contacts.length > 0) {
          contactId = searchData.contacts[0].id;
          console.log(`Found existing contact: ${contactId}`);
        }
      } else {
        const errText = await searchResponse.text();
        console.log(`Contact search returned ${searchResponse.status}: ${errText}`);
      }
    } catch (err) {
      console.log('Contact search failed:', err);
    }

    // If no contact found, try to create one
    if (!contactId) {
      try {
        const createResponse = await fetch(
          `${baseUrl}/contacts`,
          {
            method: 'POST',
            headers,
            body: JSON.stringify({
              locationId,
              email: toEmail,
              name: toEmail.split('@')[0],
              source: 'Funding Sonar'
            })
          }
        );
        
        if (createResponse.ok) {
          const createData = await createResponse.json();
          contactId = createData.contact?.id;
          console.log(`Created new contact: ${contactId}`);
        }
      } catch (err) {
        console.log('Contact creation failed');
      }
    }

    if (!contactId) {
      console.error('Could not find or create GHL contact for email:', toEmail);
      return { success: false, error: `No GHL contact found or created for ${toEmail}` };
    }

    // Send email via V2 conversations API
    const emailResponse = await fetch(
      `${baseUrl}/conversations/messages`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          type: 'Email',
          contactId,
          subject,
          html: body.replace(/\n/g, '<br>'),
        })
      }
    );

    if (emailResponse.ok) {
      return { success: true };
    } else {
      const errorData = await emailResponse.json().catch(() => ({}));
      console.error('GHL email API error:', errorData);
      return { success: false, error: errorData.message || 'GHL API error' };
    }

  } catch (error: unknown) {
    console.error('sendGHLEmail error:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}
