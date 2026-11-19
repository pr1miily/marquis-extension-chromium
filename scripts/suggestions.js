document.addEventListener("DOMContentLoaded", () => {
    const sendBtn = document.getElementById('sendSuggestionBtn');
    
    sendBtn?.addEventListener('click', async function() {
        const type = document.getElementById('feedbackType').value;
        const email = document.getElementById('feedbackEmail').value.trim();
        const message = document.getElementById('suggestionText').value.trim();
        
        // 🟢 Grab the honeypot value
        const isBot = document.getElementById('suggestionBotcheck').checked;
        
        if (!message) {
            if (window.showGlobalAlert) window.showGlobalAlert('Empty Message', 'I cannot dispatch a blank letter. Pray, enter a message before sending.', 'warning');
            return;
        }
        
        const sysInfo = `
--- Diagnostic Info ---
Type: ${type}
User Email: ${email || 'Not provided'}
User Agent: ${navigator.userAgent}
Extension Version: ${chrome.runtime.getManifest().version}
Time: ${new Date().toISOString()}
-----------------------`;

        const fullBody = `${message}\n\n${sysInfo}`;
        const subject = `Marquis User: ${type}`;

        const originalBtnText = sendBtn.innerHTML;
        sendBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Sending...';
        sendBtn.disabled = true;

        try {
            const response = await fetch('https://api.web3forms.com/submit', {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json', 
                    'Accept': 'application/json' 
                },
                body: JSON.stringify({
                    access_key: "43498a27-f3a8-4f7b-bc51-b902216c9c7e", // Double check this!
                    subject: subject,
                    from_name: "Marquis Ext User",
                    email: email || "noreply@marquis.local",
                    message: fullBody,
                    botcheck: isBot
                })
            });

            // 🟢 NEW: Parse the actual response from Web3Forms
            const result = await response.json();

            if (response.ok) {
                document.getElementById('suggestionText').value = '';
                document.getElementById('feedbackEmail').value = '';
                
                if (window.showGlobalAlert) {
                    window.showGlobalAlert('Sent!', 'Thank you for your feedback.', 'success');
                }
            } else {
                // 🟢 NEW: Throw the exact error message provided by the API
                throw new Error(result.message || "The API has impolitely rejected our request.");
            }
        } catch (error) {
            // 🟢 NEW: Log the exact error to the console
            console.error("Feedback Error Details:", error.message);
            if (window.showGlobalAlert) {
                window.showGlobalAlert('Delivery Thwarted', `Alas, the courier failed: ${error.message}`, 'error');
            }
        } finally {
            sendBtn.innerHTML = originalBtnText;
            sendBtn.disabled = false;
        }
    });
});