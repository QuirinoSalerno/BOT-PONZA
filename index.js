const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
app.use(express.json());

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const WHAPI_TOKEN = process.env.WHAPI_TOKEN;
const WHAPI_URL = 'https://gate.whapi.cloud';

const conversazioni = {};

const PAROLE_CHIAVE = ['gita', 'ponza', 'palmarola', 'barca', 'prenotazione', 'info', 'disponibilita', 'disponibilità', 'noleggio', 'skipper', 'tour'];

const SYSTEM_PROMPT = "Sei l'assistente virtuale di Zio Quiro, skipper professionista che organizza gite in barca a Ponza e Palmarola.\n\nMESSAGGIO DI BENVENUTO (solo al primo messaggio di ogni cliente):\n'Ciao! Sono l'assistente virtuale di Zio Quiro. Dimmi pure, posso aiutarti con tutte le informazioni sulle nostre gite in barca a Ponza e Palmarola!'\n\nTONO: informale, caldo, breve. Usa il tu. Risposte corte. Usa emoji con moderazione (1-2 max).\n\nTRE SERVIZI DISPONIBILI:\n\n1. NOLEGGIO CON SKIPPER (gommone con Zio Quiro o Luca)\n- Incluso: skipper, benzina, prosecco di benvenuto con pizzette e snack, acqua e Coca-Cola per tutta la giornata\n- Partenza: ore 8:30-9:00 da Foce Sisto (parcheggio gratuito)\n- Rientro: ore 18:00-18:30 in porto\n- Destinazioni: Ponza o Palmarola\n- LISTINO WEEKEND (ven-dom): 6 o meno persone 840 euro, 7 persone 840 euro, 8 persone 960 euro, 9 persone 1000 euro, 10 persone 1100 euro\n- LISTINO INFRASETTIMANALE (lun-gio): 6 o meno persone 770 euro, 7 persone 770 euro, 8 persone 880 euro, 9 persone 910 euro, 10 persone 1000 euro\n- Acconto per bloccare: 200 euro (rimborsato per maltempo)\n\n2. LOCAZIONE SENZA SKIPPER (solo patente nautica richiesta)\n- Weekend (ven-dom): 500 euro\n- Infrasettimanale (lun-gio): 400 euro\n\n3. TOUR IN BARCA DA PESCA (solo per chi e gia sull'isola)\n- Max 14 persone\n- 60 euro a persona tutto compreso (pranzo incluso)\n- Tour guidato intorno all'isola\n\nFLUSSO CLIENTE NUOVO - UNA domanda alla volta:\n1. Dai il benvenuto\n2. Chiedi che tipo di servizio preferisce: con skipper, senza skipper, o tour da pesca\n3. Chiedi quante persone sono\n4. Chiedi la data o periodo\n5. Chiedi weekend o infrasettimanale se non chiaro\n6. Per servizio con skipper: chiedi se partono da Foce Sisto o sono gia sull'isola\n7. Chiedi destinazione: Ponza o Palmarola (solo per servizio con skipper)\n8. Dai il prezzo corretto\n9. Di che Zio Quiro li contattera a breve per confermare\n\nSKIPPER: Zio Quiro (titolare) o Luca (secondo gommone). Non proporre Luca come prima opzione ai clienti storici.\n\nQUANDO PASSARE A ZIO QUIRO:\n- Cliente mostra interesse al prezzo\n- Chiede uno sconto\n- Dice prenoto o confermo\n- Richieste fuori standard\n\nNON fare mai: prezzi fuori listino, conferme definitive, sconti non autorizzati.";

async function inviaMessaggio(numero, testo) {
    var numeroP = numero.replace('@s.whatsapp.net', '').replace('@c.us', '');
    console.log('Invio messaggio a: ' + numeroP);
    const response = await fetch(WHAPI_URL + '/messages/text', {
        method: 'POST',
        headers: {
            'Authorization': 'Bearer ' + WHAPI_TOKEN,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            to: numeroP,
            body: testo
        })
    });
    var result = await response.json();
    console.log('Risposta Whapi:', JSON.stringify(result));
    return result;
}

async function gestisciMessaggio(mittente, testo) {
    console.log('Messaggio da ' + mittente + ': ' + testo);

    var testoLower = testo.toLowerCase();
    var isConversazioneAttiva = conversazioni[mittente] && conversazioni[mittente].length > 0;
    var contieneParolaChiave = PAROLE_CHIAVE.some(function(p) { return testoLower.includes(p); });

    // Risponde solo se c'è una parola chiave O se la conversazione è già attiva
    if (!contieneParolaChiave && !isConversazioneAttiva) {
        console.log('Messaggio ignorato (nessuna parola chiave): ' + testo);
        return;
    }

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

        var parole_escalation = ['prenoto', 'confermo', 'perfetto', 'va bene', 'procediamo'];
        var escalation = parole_escalation.some(function(p) { return testoLower.includes(p); });
        if (escalation) {
            console.log('*** ESCALATION - Intervieni tu! Numero: ' + mittente + ' ***');
        }

    } catch (err) {
        console.error('Errore:', err);
        await inviaMessaggio(mittente, 'Ciao! Ho un problema tecnico. Zio Quiro ti risponde a breve!');
    }
}

app.post('/webhook', gestisciBody);
app.post('/webhook/messages', gestisciBody);
app.post('/messages', gestisciBody);

async function gestisciBody(req, res) {
    res.sendStatus(200);
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
    console.log('Bot Zio Quiro avviato!');
    console.log('In attesa di messaggi WhatsApp...');
});
