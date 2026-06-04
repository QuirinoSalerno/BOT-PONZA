const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
app.use(express.json());

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const WHAPI_TOKEN = process.env.WHAPI_TOKEN;
const WHAPI_URL = 'https://gate.whapi.cloud';
const NUMERO_QUIRINO = process.env.NUMERO_QUIRINO || '';

const conversazioni = {};
const ultimoMessaggio = {};
const quirinoPreso = {};
const TIMEOUT_CONVERSAZIONE = 2 * 60 * 60 * 1000;

const PAROLE_CHIAVE = [
    'gita', 'ponza', 'palmarola', 'ventotene', 'barca', 'gommone',
    'prenotazione', 'info', 'informazioni', 'disponibilita', 'disponibilità',
    'noleggio', 'skipper', 'tour', 'escursione', 'mare', 'isola',
    'vacanza', 'estate', 'giugno', 'luglio', 'agosto', 'settembre',
    'costo', 'prezzo', 'quanto', 'posto', 'posti', 'disponibile',
    'charter', 'giornata'
];

const SYSTEM_PROMPT = "Sei l'assistente virtuale di Zio Quiro, skipper professionista che organizza gite in barca a Ponza e Palmarola.\n\nMESSAGGIO DI BENVENUTO (solo al primo messaggio):\nCiao! Sono l'assistente virtuale di Zio Quiro. Posso aiutarti con informazioni sulle nostre gite in barca a Ponza e Palmarola!\n\nTONO: informale, caldo, breve. Usa il tu. Risposte corte. Emoji con moderazione.\n\nTRE SERVIZI DISPONIBILI:\n\n1. NOLEGGIO CON SKIPPER\n- Incluso: skipper, benzina, prosecco con pizzette e snack, acqua e Coca-Cola\n- Partenza: 8:30-9:00 da Foce Sisto (parcheggio gratuito)\n- Rientro: 18:00-18:30\n- PRANZO NON INCLUSO\n- LISTINO WEEKEND (ven-dom): fino a 7 persone 840 euro, 8 persone 960 euro, 9 persone 1000 euro, 10 persone 1100 euro\n- LISTINO INFRASETTIMANALE (lun-gio): fino a 7 persone 770 euro, 8 persone 880 euro, 9 persone 910 euro, 10 persone 1000 euro\n- Acconto: 200 euro (rimborsato per maltempo)\n\n2. LOCAZIONE SENZA SKIPPER (patente nautica richiesta)\n- Weekend: 500 euro\n- Infrasettimanale: 400 euro\n\n3. TOUR IN BARCA DA PESCA (solo per chi e gia sull'isola)\n- Max 14 persone, 60 euro a persona, pranzo incluso\n\nSERVIZIO SPECIALE ESCLUSIVA (max 4 persone, pranzo incluso):\n- Questo servizio e personalizzato, il cliente deve parlare direttamente con Zio Quiro\n- Di solo: 'Per il servizio esclusiva con pranzo incluso ti metto in contatto con Zio Quiro direttamente!'\n\nSe chiedono se il pranzo e compreso nelle gite normali: NO, il pranzo non e incluso nelle gite standard.\n\nFLUSSO - UNA domanda alla volta:\n1. Benvenuto\n2. Tipo servizio: con skipper, senza skipper, tour da pesca\n3. Quante persone\n4. Data o periodo\n5. Weekend o infrasettimanale\n6. Partono da Foce Sisto o gia sull'isola\n7. Destinazione: Ponza o Palmarola\n8. Prezzo corretto\n9. Zio Quiro li contattera a breve\n\nQUANDO PASSARE A ZIO QUIRO:\n- Cliente interessato al prezzo\n- Chiede sconto\n- Dice prenoto o confermo\n- Vuole servizio esclusiva con pranzo\n- Richieste fuori standard\n\nSe ti scrivono cose non inerenti alle gite rispondi: 'Posso aiutarti solo con informazioni sulle gite di Zio Quiro!'";

async function inviaMessaggio(numero, testo) {
    var numeroP = numero.replace('@s.whatsapp.net', '').replace('@c.us', '');
    const response = await fetch(WHAPI_URL + '/messages/text', {
        method: 'POST',
        headers: {
            'Authorization': 'Bearer ' + WHAPI_TOKEN,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ to: numeroP, body: testo })
    });
    var result = await response.json();
    console.log('Risposta Whapi:', JSON.stringify(result));
    return result;
}

async function notificaQuirino(mittente, testo, conversazione) {
    if (!NUMERO_QUIRINO) return;
    var riepilogo = '🚨 NUOVA RICHIESTA — intervieni tu!\n\n';
    riepilogo += '📱 Numero: ' + mittente.replace('@s.whatsapp.net', '') + '\n';
    riepilogo += '💬 Ultimo messaggio: ' + testo + '\n';
    riepilogo += '➡️ Il cliente e pronto per essere contattato!';
    await inviaMessaggio(NUMERO_QUIRINO, riepilogo);
}

async function gestisciMessaggio(mittente, testo) {
    console.log('Messaggio da ' + mittente + ': ' + testo);

    var testoLower = testo.toLowerCase();
    var adesso = Date.now();

    // Reset conversazione scaduta
    if (ultimoMessaggio[mittente] && (adesso - ultimoMessaggio[mittente]) > TIMEOUT_CONVERSAZIONE) {
        console.log('Conversazione scaduta - reset');
        delete conversazioni[mittente];
        delete ultimoMessaggio[mittente];
        delete quirinoPreso[mittente];
    }

    // Se Quirino ha preso in mano la chat non rispondere
    if (quirinoPreso[mittente]) {
        console.log('Quirino ha preso la chat - bot silenzioso');
        return;
    }

    var isConversazioneAttiva = conversazioni[mittente] && conversazioni[mittente].length > 0;
    var contieneParolaChiave = PAROLE_CHIAVE.some(function(p) { return testoLower.includes(p); });

    if (!contieneParolaChiave && !isConversazioneAttiva) {
        console.log('Messaggio ignorato: ' + testo);
        return;
    }

    ultimoMessaggio[mittente] = adesso;

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

        var parole_escalation = ['prenoto', 'confermo', 'procediamo', 'esclusiva'];
        var escalation = parole_escalation.some(function(p) { return testoLower.includes(p); });
        if (escalation) {
            console.log('*** ESCALATION - Intervieni tu! Numero: ' + mittente + ' ***');
            await notificaQuirino(mittente, testo, conversazioni[mittente]);
        }

    } catch (err) {
        console.error('Errore:', err);
        await inviaMessaggio(mittente, 'Ciao! Ho un problema tecnico. Zio Quiro ti risponde a breve!');
    }
}

// Endpoint per silenziare il bot su una chat (chiamato quando Quirino risponde)
app.post('/silenzia', function(req, res) {
    var numero = req.body.numero;
    if (numero) {
        quirinoPreso[numero] = true;
        console.log('Bot silenziato per: ' + numero);
        res.json({ ok: true });
    } else {
        res.json({ ok: false });
    }
});

app.post('/webhook', gestisciBody);
app.post('/webhook/messages', gestisciBody);
app.post('/messages', gestisciBody);

async function gestisciBody(req, res) {
    res.sendStatus(200);
    var body = req.body;

    // Se Quirino risponde, silenzia il bot per quel numero
    var messages = body.messages || (body.message ? [body.message] : null);
    if (!messages || messages.length === 0) return;

    for (var i = 0; i < messages.length; i++) {
        var msg = messages[i];

        // Se il messaggio è di Quirino stesso, silenzia il bot per quel contatto
        if (msg.from_me) {
            var chat = msg.chat_id;
            if (chat && !chat.includes('g.us')) {
                quirinoPreso[chat] = true;
                ultimoMessaggio[chat] = Date.now();
                console.log('Quirino ha risposto - bot silenziato per: ' + chat);
            }
            continue;
        }

        if (msg.type !== 'text') continue;
        var mittente = msg.chat_id || msg.from;
        var testo = (msg.text && msg.text.body) || msg.body;
        if (!testo) continue;
        await gestisciMessaggio(mittente, testo);
    }
}

app.listen(process.env.PORT || 3000, function() {
    console.log('Bot Zio Quiro avviato!');
    console.log('In attesa di messaggi WhatsApp...');
});
