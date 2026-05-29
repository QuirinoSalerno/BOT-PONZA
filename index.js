const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
app.use(express.json());

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const WHAPI_TOKEN = process.env.WHAPI_TOKEN;
const WHAPI_URL = 'https://gate.whapi.cloud';

const conversazioni = {};

const SYSTEM_PROMPT = "Sei l'assistente virtuale di Quirino, skipper professionista che organizza gite in barca a Ponza e Palmarola con partenza da Foce Sisto (parcheggio gratuito).\n\nTONO: informale, caldo, breve. Usa il tu. Risposte corte come in una chat normale. Usa emoji con moderazione (1-2 a messaggio max).\n\nLISTINO 2026 tutto compreso (benzina, prosecco, acqua, bibite):\n- Fino a 7 persone esclusiva: 850 euro\n- 8 persone: 960 euro weekend\n- 9 persone: 1000 euro\n- 10 persone: 1100 euro\n- Infrasettimanale (lun-gio): sconto rispetto al weekend\n- Acconto per bloccare: 200 euro (rimborsato per maltempo)\n\nPARTENZA: ore 8:00 da Foce Sisto. Parcheggio gratuito.\nDESTINAZIONI: Ponza o Palmarola.\nSKIPPER: Quirino o Luca (secondo gommone). Non proporre Luca come prima opzione.\n\nFLUSSO CLIENTE NUOVO - UNA domanda alla volta:\n1. Benvenuto + quante persone siete?\n2. Che data o periodo avete in mente?\n3. Weekend o infrasettimanale?\n4. Destinazione: Ponza o Palmarola?\n5. Partite da Foce Sisto o siete gia sull'isola?\n6. Dai il prezzo corretto dal listino\n7. Di che Quirino li contattera a breve per confermare\n\nQUANDO PASSARE A QUIRINO:\n- Cliente mostra interesse al prezzo\n- Chiede uno sconto\n- Dice prenoto o confermo\n- Richieste fuori standard\n\nNON fare mai: prezzi fuori listino, conferme definitive, sconti non autorizzati.";

async function inviaMessaggio(numero, testo) {
    const response = await fetch(WHAPI_URL + '/messages/text', {
        method: 'POST',
        headers: {
            'Authorization': 'Bearer ' + WHAPI_TOKEN,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            to: numero,
            body: testo
        })
    });
    return response.json();
}

async function gestisciMessaggio(mittente, testo) {
    console.log('Messaggio da ' + mittente + ': ' + testo);

    if (!conversazioni[mittente]) {
        conversazioni[mittente] = [];
    }

    conversazioni[mittente].push({ role: 'user', content: testo });

    if (conversazioni[mittente].length > 20) {
        conversazioni[mittente] = conversazioni[mittente].slice(-20);
    }

    try {
        var risposta = await anthropic.messages.create({
            model: 'claude-sonnet-4-5',
            max_tokens: 500,
            system: SYSTEM_PROMPT,
            messages: conversazioni[mittente]
        });

        var testo_risposta = risposta.content[0].text;
        conversazioni[mittente].push({ role: 'assistant', content: testo_risposta });

        console.log('Risposta: ' + testo_risposta);
        await inviaMessaggio(mittente, testo_risposta);

        var parole_chiave = ['prenoto', 'confermo', 'perfetto', 'va bene', 'procediamo'];
        var escalation = parole_chiave.some(function(p) { return testo.toLowerCase().includes(p); });
        if (escalation) {
            console.log('*** ESCALATION - Intervieni tu! Numero: ' + mittente + ' ***');
        }

    } catch (err) {
        console.error('Errore:', err);
        await inviaMessaggio(mittente, 'Ciao! Ho un problema tecnico. Quirino ti risponde a breve!');
    }
}

// Gestisce tutti i percorsi webhook
app.post('/webhook', gestisciBody);
app.post('/webhook/messages', gestisciBody);
app.post('/messages', gestisciBody);

async function gestisciBody(req, res) {
    res.sendStatus(200);
    console.log('Webhook ricevuto:', JSON.stringify(req.body).substring(0, 200));

    var body = req.body;
    var messages = body.messages || (body.message ? [body.message] : null);
    
    if (!messages || messages.length === 0) return;

    for (var i = 0; i < messages.length; i++) {
        var msg = messages[i];
        if (msg.from_me) continue;
        if (msg.type !== 'text') continue;

        var mittente = msg.chat_id || msg.from;
        var testo = (msg.text && msg.text.body) || msg.body;
        if (!testo) continue;

        await gestisciMessaggio(mittente, testo);
    }
}

app.listen(process.env.PORT || 3000, function() {
    console.log('Bot Whapi avviato!');
    console.log('In attesa di messaggi WhatsApp...');
});
