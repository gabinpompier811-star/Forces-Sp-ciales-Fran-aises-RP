require('dotenv').config();

const { 
    Client, 
    GatewayIntentBits, 
    REST, 
    Routes, 
    SlashCommandBuilder, 
    ChannelType, 
    PermissionFlagsBits, 
    EmbedBuilder,
    ButtonBuilder,
    ButtonStyle,
    MessageFlags,
    AttachmentBuilder,
    ModalBuilder, 
    TextInputBuilder, 
    TextInputStyle, 
    ActionRowBuilder 
} = require('discord.js');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const TOKEN = (process.env.DISCORD_TOKEN || '').trim();
const DATABASE_URL = process.env.FIREBASE_DATABASE_URL
    || "https://forces-speciales-francaises-default-rtdb.europe-west1.firebasedatabase.app";
const FIREBASE_API_KEY = (process.env.FIREBASE_API_KEY || '').trim();
const FIREBASE_AUTH_EMAIL = (process.env.FIREBASE_AUTH_EMAIL || '').trim();
const FIREBASE_AUTH_PASSWORD = process.env.FIREBASE_AUTH_PASSWORD || '';

if (!TOKEN) {
    throw new Error('Jeton Discord manquant : renseigne DISCORD_TOKEN dans le fichier .env.');
}

async function getFirebaseIdToken() {
    if (!FIREBASE_API_KEY || !FIREBASE_AUTH_EMAIL || !FIREBASE_AUTH_PASSWORD) {
        throw new Error('Configuration Firebase Auth manquante : renseigne FIREBASE_API_KEY, FIREBASE_AUTH_EMAIL et FIREBASE_AUTH_PASSWORD dans le fichier .env.');
    }

    const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(FIREBASE_API_KEY)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            email: FIREBASE_AUTH_EMAIL,
            password: FIREBASE_AUTH_PASSWORD,
            returnSecureToken: true
        })
    });
    const result = await response.json();
    if (!response.ok || !result.idToken) {
        throw new Error(result.error?.message || `Firebase Auth HTTP ${response.status}`);
    }
    return result.idToken;
}

async function saveFirebaseDemand(formData) {
    const idToken = await getFirebaseIdToken();
    const response = await fetch(`${DATABASE_URL.replace(/\/$/, '')}/demandes.json?auth=${encodeURIComponent(idToken)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
    });
    const result = await response.json();
    if (!response.ok || !result.name) {
        throw new Error(result.error || `Realtime Database HTTP ${response.status}`);
    }
}

async function saveFirebaseIdentityRecord(request) {
    const idToken = await getFirebaseIdToken();
    const databaseRoot = DATABASE_URL.replace(/\/$/, '');
    const effectifsResponse = await fetch(`${databaseRoot}/effectifs.json?auth=${encodeURIComponent(idToken)}`);
    const existingEffectifs = await effectifsResponse.json();
    if (!effectifsResponse.ok) {
        throw new Error(existingEffectifs.error || `Realtime Database HTTP ${effectifsResponse.status}`);
    }

    const identity = request.identity;
    const dossier = request.dossier;
    const applicantDiscordId = String(request.applicantId || '').trim();
    if (!applicantDiscordId) {
        throw new Error('Impossible de relier la carte à son demandeur Discord.');
    }
    const normalizeMatricule = value => String(value || '').trim().toLocaleLowerCase('fr-FR');
    const normalizedMatricule = normalizeMatricule(dossier.mat);
    const hasUniqueMatricule = normalizedMatricule && !['n/a', 'na', 'aucun'].includes(normalizedMatricule);
    const matchingEffectifs = hasUniqueMatricule
        ? Object.entries(existingEffectifs || {}).filter(([, record]) =>
            record && normalizeMatricule(record.mat) === normalizedMatricule
        )
        : [];
    if (matchingEffectifs.some(([, record]) => record.discordId && record.discordId !== applicantDiscordId)) {
        throw new Error('Ce matricule est déjà associé à un autre compte Discord.');
    }
    const identityKey = matchingEffectifs
        .map(([, record]) => record.carteIdentiteKey)
        .find(Boolean) || request.id;
    const updates = {};
    if (matchingEffectifs.length) {
        matchingEffectifs.forEach(([effectifKey, record]) => {
            updates[`effectifs/${effectifKey}`] = {
                ...record,
                nom: `${identity.firstNames} ${identity.lastName}`.trim(),
                grade: dossier.grade,
                mat: dossier.mat,
                aff: dossier.aff,
                notesPerso: dossier.notesPerso,
                carteIdentiteKey: identityKey,
                discordId: applicantDiscordId
            };
        });
    } else {
        updates[`effectifs/${request.id}`] = {
            id: request.id,
            nom: `${identity.firstNames} ${identity.lastName}`.trim(),
            grade: dossier.grade,
            mat: dossier.mat,
            aff: dossier.aff,
            notesPerso: dossier.notesPerso,
            form: '',
            dateDemande: new Date().toLocaleDateString('fr-FR'),
            eval: { evaluee: false },
            carteIdentiteKey: identityKey,
            discordId: applicantDiscordId
        };
    }
    updates[`cartesIdentite/${identityKey}`] = {
        nom: identity.lastName,
        prenoms: identity.firstNames,
        dateNaissance: identity.birthDate,
        lieuNaissance: identity.birthPlace,
        nationalite: identity.nationality,
        sexe: identity.sex,
        adresse: identity.address,
        dateEngagement: identity.engagementDate,
        devisePersonnelle: identity.motto,
        updatedAt: request.reviewedAt,
        updatedBy: request.reviewedBy
    };
    const response = await fetch(`${databaseRoot}/.json?auth=${encodeURIComponent(idToken)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
    });
    const result = await response.json();
    if (!response.ok) {
        throw new Error(result.error || `Realtime Database HTTP ${response.status}`);
    }
    return {
        identityKey,
        effectifKeys: matchingEffectifs.length ? matchingEffectifs.map(([key]) => key) : [request.id]
    };
}

async function getFirebaseIdentityForDiscordUser(discordId) {
    const idToken = await getFirebaseIdToken();
    const databaseRoot = DATABASE_URL.replace(/\/$/, '');
    const [effectifsResponse, identitiesResponse] = await Promise.all([
        fetch(`${databaseRoot}/effectifs.json?auth=${encodeURIComponent(idToken)}`),
        fetch(`${databaseRoot}/cartesIdentite.json?auth=${encodeURIComponent(idToken)}`)
    ]);
    const [effectifs, identities] = await Promise.all([
        effectifsResponse.json(),
        identitiesResponse.json()
    ]);
    if (!effectifsResponse.ok) {
        throw new Error(effectifs.error || `Lecture des dossiers impossible (HTTP ${effectifsResponse.status}).`);
    }
    if (!identitiesResponse.ok) {
        throw new Error(identities.error || `Lecture des cartes impossible (HTTP ${identitiesResponse.status}).`);
    }

    const linkedEffectifs = Object.entries(effectifs || {})
        .filter(([, record]) => record && record.discordId === discordId);
    const identityKeys = new Set(
        linkedEffectifs.map(([key, record]) => record.carteIdentiteKey || key)
    );
    const completedRequests = Object.values(identityState.requests)
        .filter(request => request.status === 'completed'
            && request.applicantId === discordId
            && request.firebaseIdentityKey)
        .sort((a, b) => Date.parse(b.reviewedAt || '') - Date.parse(a.reviewedAt || ''));
    completedRequests.forEach(request => identityKeys.add(request.firebaseIdentityKey));

    const candidates = [...identityKeys]
        .map(identityKey => ({
            identityKey,
            identity: identities?.[identityKey],
            request: completedRequests.find(item => item.firebaseIdentityKey === identityKey)
        }))
        .filter(candidate => candidate.identity && typeof candidate.identity === 'object')
        .sort((a, b) => Date.parse(b.identity.updatedAt || '') - Date.parse(a.identity.updatedAt || ''));
    const selected = candidates[0];
    if (!selected) return null;

    const effectif = linkedEffectifs.find(([key, record]) =>
        (record.carteIdentiteKey || key) === selected.identityKey
    )?.[1] || Object.entries(effectifs || {}).find(([key, record]) =>
        record && (record.carteIdentiteKey || key) === selected.identityKey
    )?.[1];
    return {
        identity: selected.identity,
        dossier: effectif || selected.request?.dossier || {}
    };
}

function buildPersonalIdentityEmbed(identity, dossier, user) {
    const display = value => String(value || '').trim().slice(0, 1024) || 'Non renseigné';
    const fullName = `${identity.prenoms || ''} ${identity.nom || ''}`.trim() || 'Carte personnelle';
    return new EmbedBuilder()
        .setColor(0x1e3a8a)
        .setTitle('🪪 Carte d’identité RP')
        .setAuthor({ name: fullName, iconURL: user.displayAvatarURL({ size: 128 }) })
        .setDescription('Tes informations enregistrées dans le dossier militaire.')
        .addFields(
            { name: 'Nom', value: display(identity.nom), inline: true },
            { name: 'Prénom(s)', value: display(identity.prenoms), inline: true },
            { name: 'Date de naissance', value: display(identity.dateNaissance), inline: true },
            { name: 'Lieu de naissance', value: display(identity.lieuNaissance), inline: true },
            { name: 'Nationalité', value: display(identity.nationalite), inline: true },
            { name: 'Sexe', value: display(identity.sexe), inline: true },
            { name: 'Adresse RP', value: display(identity.adresse), inline: false },
            { name: 'Date d’engagement', value: display(identity.dateEngagement), inline: true },
            { name: 'Devise personnelle', value: display(identity.devisePersonnelle), inline: false },
            { name: 'Grade', value: display(dossier.grade), inline: true },
            { name: 'Matricule', value: display(dossier.mat), inline: true },
            { name: 'Affectation', value: display(dossier.aff), inline: true }
        )
        .setFooter({ text: 'Consultation privée • données de roleplay' })
        .setTimestamp();
}

const IDENTITY_STATE_PATH = path.join(__dirname, 'identity-state.json');
const identityState = { configurations: {}, requests: {} };
let identitySaveQueue = Promise.resolve();
const identitySessions = new Map();
const identityEditSessions = new Map();
const IDENTITY_UNITS = [
    'N/A',
    'CPA 10',
    '4e RHFS',
    '13e RDP',
    'Commandos Jaubert (marine)',
    'Groupe de Commandos Parachutistes (GCP)'
];

async function loadIdentityState() {
    let rawState;
    try {
        rawState = await fs.readFile(IDENTITY_STATE_PATH, 'utf8');
    } catch (error) {
        if (error.code === 'ENOENT') return;
        throw error;
    }

    const savedState = JSON.parse(rawState);
    if (!savedState || typeof savedState !== 'object' || Array.isArray(savedState)
        || (savedState.configurations && (typeof savedState.configurations !== 'object' || Array.isArray(savedState.configurations)))
        || (savedState.requests && (typeof savedState.requests !== 'object' || Array.isArray(savedState.requests)))) {
        throw new Error('Le fichier identity-state.json a un format invalide.');
    }
    identityState.configurations = savedState.configurations || {};
    identityState.requests = savedState.requests || {};
}

function saveIdentityState() {
    const writeState = async () => {
        const temporaryPath = `${IDENTITY_STATE_PATH}.tmp`;
        await fs.writeFile(temporaryPath, JSON.stringify(identityState, null, 2), { encoding: 'utf8', mode: 0o600 });
        await fs.rename(temporaryPath, IDENTITY_STATE_PATH);
    };
    identitySaveQueue = identitySaveQueue.then(writeState, writeState);
    return identitySaveQueue;
}

function isValidFrenchDate(value) {
    const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim());
    if (!match) return false;
    const day = Number(match[1]);
    const month = Number(match[2]);
    const year = Number(match[3]);
    const date = new Date(year, month - 1, day);
    return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

function buildIdentityModal(title, customId, fields) {
    const modal = new ModalBuilder()
        .setCustomId(customId)
        .setTitle(title);

    fields.forEach(field => {
        const input = new TextInputBuilder()
            .setCustomId(field.id)
            .setLabel(field.label)
            .setStyle(field.style || TextInputStyle.Short)
            .setRequired(field.required !== false)
            .setMaxLength(field.maxLength);
        if (field.placeholder) input.setPlaceholder(field.placeholder);
        if (field.value) input.setValue(field.value);
        modal.addComponents(new ActionRowBuilder().addComponents(input));
    });
    return modal;
}

function buildIdentityRequestModal(step, sessionId) {
    const fieldsByStep = {
        1: [
            { id: 'lastName', label: 'Nom', placeholder: 'Ex : Marquina', maxLength: 80 },
            { id: 'firstNames', label: 'Prénom(s)', placeholder: 'Ex : Sergio', maxLength: 100 },
            { id: 'birthDate', label: 'Date de naissance (JJ/MM/AAAA)', placeholder: '01/03/2004', maxLength: 10 },
            { id: 'birthPlace', label: 'Lieu de naissance', placeholder: 'Ex : Amsterdam', maxLength: 100 },
            { id: 'nationality', label: 'Nationalité', placeholder: 'Ex : Mexicain', maxLength: 60 }
        ],
        2: [
            { id: 'sex', label: 'Sexe', placeholder: 'Ex : M', maxLength: 20 },
            { id: 'address', label: 'Adresse (donnée RP uniquement)', placeholder: 'Adresse fictive', style: TextInputStyle.Paragraph, maxLength: 250 },
            { id: 'engagementDate', label: "Date d'engagement (JJ/MM/AAAA)", placeholder: '20/11/2026', maxLength: 10 },
            { id: 'motto', label: 'Devise personnelle', placeholder: 'Ex : Toujours arriver à la ligne d’arrivée', style: TextInputStyle.Paragraph, maxLength: 180 }
        ]
    };
    return buildIdentityModal(
        `Demande de carte — étape ${step}/2`,
        `identity:request:submit:${step}:${sessionId}`,
        fieldsByStep[step]
    );
}

function buildIdentityReviewModal(step, sessionId, data) {
    const fieldsByStep = {
        1: [
            { id: 'lastName', label: 'Nom', maxLength: 80, value: data.identity.lastName },
            { id: 'firstNames', label: 'Prénom(s)', maxLength: 100, value: data.identity.firstNames },
            { id: 'birthDate', label: 'Date de naissance (JJ/MM/AAAA)', maxLength: 10, value: data.identity.birthDate },
            { id: 'birthPlace', label: 'Lieu de naissance', maxLength: 100, value: data.identity.birthPlace },
            { id: 'nationality', label: 'Nationalité', maxLength: 60, value: data.identity.nationality }
        ],
        2: [
            { id: 'sex', label: 'Sexe', maxLength: 20, value: data.identity.sex },
            { id: 'address', label: 'Adresse RP', style: TextInputStyle.Paragraph, maxLength: 250, value: data.identity.address },
            { id: 'engagementDate', label: "Date d'engagement (JJ/MM/AAAA)", maxLength: 10, value: data.identity.engagementDate },
            { id: 'motto', label: 'Devise personnelle', style: TextInputStyle.Paragraph, maxLength: 180, value: data.identity.motto }
        ],
        3: [
            { id: 'grade', label: 'Grade', placeholder: 'Ex : Sergent', maxLength: 60, value: data.dossier.grade || '' },
            { id: 'matricule', label: 'Matricule', placeholder: 'Ex : MAT-8890', maxLength: 40, value: data.dossier.mat || '' },
            { id: 'unit', label: 'Unité / affectation', placeholder: 'Ex : CPA 10', maxLength: 100, value: data.dossier.aff || '' },
            { id: 'notes', label: 'Notes du dossier (facultatif)', style: TextInputStyle.Paragraph, required: false, maxLength: 300, value: data.dossier.notesPerso || '' }
        ]
    };
    return buildIdentityModal(
        `Vérification instructeur — étape ${step}/3`,
        `identity:review:submit:${step}:${sessionId}`,
        fieldsByStep[step]
    );
}

function identityButton(customId, label, style = ButtonStyle.Primary) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(customId)
            .setLabel(label)
            .setStyle(style)
    );
}

function buildIdentityPanel() {
    const embed = new EmbedBuilder()
        .setColor(0x2563eb)
        .setTitle('🪪 Créer une carte d’identité RP')
        .setDescription('Clique sur le bouton pour transmettre uniquement tes informations d’identité. Un instructeur vérifiera la carte et renseignera le grade, le matricule et l’affectation.\n\nUtilise uniquement des données fictives de roleplay.');
    return {
        embeds: [embed],
        components: [identityButton('identity:panel:create', 'Créer une carte d’identité')],
        allowedMentions: { parse: [] }
    };
}

function buildIdentityRequestEmbed(request) {
    const identity = request.identity;
    const isPending = request.status === 'pending';
    const embed = new EmbedBuilder()
        .setColor(isPending ? 0xf59e0b : request.status === 'completed' ? 0x16a34a : 0xdc2626)
        .setTitle(isPending ? 'Demande de carte d’identité à vérifier' : `Carte ${request.status === 'completed' ? 'validée' : 'refusée'}`)
        .setDescription(`Demandeur : <@${request.applicantId}>\nRéférence : \`${request.id.slice(0, 8)}\``)
        .addFields(
            { name: 'Nom', value: identity.lastName, inline: true },
            { name: 'Prénom(s)', value: identity.firstNames, inline: true },
            { name: 'Naissance', value: `${identity.birthDate} — ${identity.birthPlace}`, inline: false },
            { name: 'Nationalité', value: identity.nationality, inline: true },
            { name: 'Sexe', value: identity.sex, inline: true },
            { name: 'Adresse RP', value: identity.address, inline: false },
            { name: 'Engagement', value: identity.engagementDate, inline: true },
            { name: 'Devise', value: identity.motto, inline: false }
        );
    if (request.dossier && request.dossier.grade) {
        embed.addFields(
            { name: 'Grade', value: request.dossier.grade, inline: true },
            { name: 'Matricule', value: request.dossier.mat, inline: true },
            { name: 'Affectation', value: request.dossier.aff, inline: true }
        );
    }
    if (request.reviewedBy) {
        embed.addFields({ name: 'Traité par', value: `<@${request.reviewedBy}>`, inline: true });
    }
    return embed;
}

function buildIdentityReviewControls(requestId) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`identity:review:edit:${requestId}`)
            .setLabel('Compléter / modifier')
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId(`identity:review:reject:${requestId}`)
            .setLabel('Refuser')
            .setStyle(ButtonStyle.Danger)
    );
}

function buildIdentityExport(request) {
    const identity = request.identity;
    const dossier = request.dossier;
    return {
        carteIdentite: {
            nom: identity.lastName,
            prenoms: identity.firstNames,
            dateNaissance: identity.birthDate,
            lieuNaissance: identity.birthPlace,
            nationalite: identity.nationality,
            sexe: identity.sex,
            adresse: identity.address,
            dateEngagement: identity.engagementDate,
            devisePersonnelle: identity.motto
        },
        dossierMilitaire: {
            nom: `${identity.firstNames} ${identity.lastName}`.trim(),
            grade: dossier.grade,
            mat: dossier.mat,
            aff: dossier.aff,
            notesPerso: dossier.notesPerso,
            form: '',
            dateDemande: new Date().toLocaleDateString('fr-FR'),
            eval: { evaluee: false }
        }
    };
}

function safeFileName(value) {
    return value.normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 40) || 'identite-rp';
}

function hasIdentityInstructorRole(interaction, configuration) {
    const roles = interaction.member?.roles;
    return Array.isArray(roles)
        ? roles.includes(configuration.instructorRoleId)
        : Boolean(roles?.cache?.has(configuration.instructorRoleId));
}

async function updateIdentityReviewMessage(request) {
    const channel = await client.channels.fetch(request.reviewChannelId);
    if (!channel || !channel.isTextBased() || !channel.messages) {
        throw new Error('Le salon privé des instructeurs est introuvable.');
    }
    const message = await channel.messages.fetch(request.reviewMessageId);
    await message.edit({
        embeds: [buildIdentityRequestEmbed(request)],
        components: request.status === 'pending' ? [buildIdentityReviewControls(request.id)] : [],
        allowedMentions: { parse: [] }
    });
}

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ]
});

// 1. Définition de la commande /formation
const commands = [
    new SlashCommandBuilder()
        .setName('formation')
        .setDescription('Ouvrir le formulaire de demande de formation/brevet/permis'),
    new SlashCommandBuilder()
        .setName('identite')
        .setDescription('Indique où trouver le panneau de création de carte'),
    new SlashCommandBuilder()
        .setName('carte-identite')
        .setDescription('Affiche ta carte d’identité RP en privé'),
    new SlashCommandBuilder()
        .setName('identite-configurer')
        .setDescription('Configure le rôle instructeur et les salons de carte d’identité')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addRoleOption(option => option
            .setName('instructeurs')
            .setDescription('Rôle autorisé à modifier et valider les cartes')
            .setRequired(true))
        .addChannelOption(option => option
            .setName('salon_panneau')
            .setDescription('Salon où les militaires/civils demanderont leur carte')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true))
        .addChannelOption(option => option
            .setName('salon_instructeurs')
            .setDescription('Salon privé où les instructeurs traiteront les demandes')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)),
    new SlashCommandBuilder()
        .setName('identite-publier')
        .setDescription('Publie ou remplace le panneau de création de carte')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
].map(command => command.toJSON());

client.once('clientReady', async () => {
    console.log(`Connecté avec succès en tant que ${client.user.tag} !`);
    try {
        await loadIdentityState();
    } catch (error) {
        console.error('Impossible de charger identity-state.json :', error);
        return;
    }
    if (!FIREBASE_API_KEY || !FIREBASE_AUTH_EMAIL || !FIREBASE_AUTH_PASSWORD) {
        console.warn('Firebase Auth incomplet dans .env : le bot démarre, mais /formation ne pourra pas enregistrer de demande.');
    }

    const rest = new REST({ version: '10' }).setToken(TOKEN);

    try {
        console.log('Déploiement des commandes slash...');
        await rest.put(
            Routes.applicationCommands(client.user.id),
            { body: commands },
        );
        console.log('Commandes slash enregistrées avec succès !');
    } catch (error) {
        console.error(error);
    }
});

// 2. Gestion des interactions
client.on('interactionCreate', async interaction => {
    if (interaction.isChatInputCommand() && interaction.commandName === 'identite-publier') {
        if (!interaction.inGuild() || !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
            await interaction.reply({ content: 'Seuls les responsables du serveur peuvent publier le panneau.', flags: MessageFlags.Ephemeral });
            return;
        }
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const configuration = identityState.configurations[interaction.guildId];
        if (!configuration) {
            await interaction.editReply('❌ Configure d’abord le rôle et les salons avec `/identite-configurer`.');
            return;
        }

        let panelMessage;
        const previousConfiguration = { ...configuration };
        try {
            const instructorRole = await interaction.guild.roles.fetch(configuration.instructorRoleId);
            const panelChannel = await interaction.guild.channels.fetch(configuration.panelChannelId);
            const reviewChannel = await interaction.guild.channels.fetch(configuration.reviewChannelId);
            if (!instructorRole || instructorRole.id === interaction.guild.id
                || !panelChannel?.isTextBased() || !panelChannel.messages
                || !reviewChannel?.isTextBased() || !reviewChannel.messages) {
                throw new Error('La configuration sauvegardée contient un rôle ou un salon introuvable.');
            }
            if (reviewChannel.permissionsFor(interaction.guild.roles.everyone)?.has(PermissionFlagsBits.ViewChannel) !== false) {
                throw new Error('Le salon instructeurs doit rester privé et invisible pour @everyone.');
            }
            if (!panelChannel.permissionsFor(interaction.guild.roles.everyone)?.has([
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.ReadMessageHistory
            ])) {
                throw new Error('Le salon du panneau doit être visible par @everyone.');
            }
            if (!reviewChannel.permissionsFor(instructorRole)?.has([
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.ReadMessageHistory
            ])) {
                throw new Error('Le rôle instructeur doit pouvoir consulter l’historique du salon privé.');
            }
            const botMember = interaction.guild.members.me || await interaction.guild.members.fetchMe();
            const requiredBotPermissions = [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.ReadMessageHistory,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.EmbedLinks
            ];
            if (!panelChannel.permissionsFor(botMember)?.has(requiredBotPermissions)
                || !reviewChannel.permissionsFor(botMember)?.has(requiredBotPermissions)) {
                throw new Error('Le bot doit pouvoir voir les deux salons, lire leur historique, envoyer des messages et intégrer des liens.');
            }

            panelMessage = await panelChannel.send(buildIdentityPanel());
            configuration.panelMessageId = panelMessage.id;
            configuration.configuredAt = new Date().toISOString();
            try {
                await saveIdentityState();
            } catch (error) {
                identityState.configurations[interaction.guildId] = previousConfiguration;
                try {
                    await panelMessage.delete();
                } catch (cleanupError) {
                    console.error('Impossible de retirer le panneau après échec de sauvegarde :', cleanupError);
                }
                throw error;
            }

            if (previousConfiguration.panelMessageId && previousConfiguration.panelMessageId !== panelMessage.id) {
                try {
                    const oldPanelChannel = await client.channels.fetch(previousConfiguration.panelChannelId);
                    if (oldPanelChannel?.isTextBased() && oldPanelChannel.messages) {
                        const oldPanelMessage = await oldPanelChannel.messages.fetch(previousConfiguration.panelMessageId);
                        await oldPanelMessage.edit({ components: [] });
                    }
                } catch (error) {
                    console.error('Impossible de désactiver l’ancien panneau :', error);
                }
            }
            await interaction.editReply(`✅ Panneau publié dans <#${panelChannel.id}>. Les demandeurs peuvent maintenant utiliser le bouton.`);
        } catch (error) {
            console.error('Échec de publication du panneau d’identité :', error);
            await interaction.editReply(`❌ Publication impossible : ${error.message}`);
        }
        return;
    }

    if (interaction.isChatInputCommand() && interaction.commandName === 'identite-configurer') {
        if (!interaction.inGuild() || !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
            await interaction.reply({ content: 'Seuls les responsables du serveur peuvent configurer ce panneau.', flags: MessageFlags.Ephemeral });
            return;
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const instructorRole = interaction.options.getRole('instructeurs', true);
        const panelChannel = interaction.options.getChannel('salon_panneau', true);
        const reviewChannel = interaction.options.getChannel('salon_instructeurs', true);
        try {
            if (instructorRole.id === interaction.guild.id) {
                throw new Error('Le rôle @everyone ne peut pas être choisi comme rôle instructeur.');
            }
            const everyoneCanViewReviewChannel = reviewChannel.permissionsFor(interaction.guild.roles.everyone)
                ?.has(PermissionFlagsBits.ViewChannel);
            if (everyoneCanViewReviewChannel !== false) {
                throw new Error('Le salon instructeurs doit être privé : @everyone ne doit pas pouvoir le voir.');
            }
            if (!panelChannel.permissionsFor(interaction.guild.roles.everyone)?.has([
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.ReadMessageHistory
            ])) {
                throw new Error('Le salon du panneau doit être visible par @everyone.');
            }
            const instructorPermissions = reviewChannel.permissionsFor(instructorRole);
            if (!instructorPermissions?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory])) {
                throw new Error('Le rôle sélectionné doit pouvoir voir l’historique du salon instructeurs.');
            }
            const botMember = interaction.guild.members.me || await interaction.guild.members.fetchMe();
            const requiredBotPermissions = [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.ReadMessageHistory,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.EmbedLinks
            ];
            if (!panelChannel.permissionsFor(botMember)?.has(requiredBotPermissions)
                || !reviewChannel.permissionsFor(botMember)?.has(requiredBotPermissions)) {
                throw new Error('Le bot doit pouvoir voir les deux salons, envoyer des messages et intégrer des liens.');
            }

            const previousConfiguration = identityState.configurations[interaction.guildId];
            const hasPendingRequests = Object.values(identityState.requests).some(request =>
                request.guildId === interaction.guildId && request.status === 'pending'
            );
            if (hasPendingRequests && previousConfiguration
                && (previousConfiguration.instructorRoleId !== instructorRole.id
                    || previousConfiguration.reviewChannelId !== reviewChannel.id)) {
                throw new Error('Traite ou refuse les demandes en attente avant de changer le rôle instructeur ou le salon privé.');
            }
            const configuration = {
                guildId: interaction.guildId,
                instructorRoleId: instructorRole.id,
                panelChannelId: panelChannel.id,
                panelMessageId: null,
                reviewChannelId: reviewChannel.id,
                configuredAt: new Date().toISOString()
            };
            identityState.configurations[interaction.guildId] = configuration;
            try {
                await saveIdentityState();
            } catch (error) {
                if (previousConfiguration) {
                    identityState.configurations[interaction.guildId] = previousConfiguration;
                } else {
                    delete identityState.configurations[interaction.guildId];
                }
                throw error;
            }

            if (previousConfiguration?.panelMessageId) {
                try {
                    const oldPanelChannel = await client.channels.fetch(previousConfiguration.panelChannelId);
                    if (oldPanelChannel?.isTextBased() && oldPanelChannel.messages) {
                        const oldPanelMessage = await oldPanelChannel.messages.fetch(previousConfiguration.panelMessageId);
                        await oldPanelMessage.edit({ components: [] });
                    }
                } catch (error) {
                    console.error('Impossible de désactiver l’ancien panneau :', error);
                }
            }
            await interaction.editReply(`✅ Configuration enregistrée. Le rôle ${instructorRole} pourra traiter les demandes dans <#${reviewChannel.id}>. Rien n’est publié pour le moment : lance /identite-publier quand tu es prêt.`);
        } catch (error) {
            console.error('Échec de configuration du panneau d’identité :', error);
            await interaction.editReply(`❌ Configuration impossible : ${error.message}`);
        }
        return;
    }

    if (interaction.isChatInputCommand() && interaction.commandName === 'identite') {
        const configuration = identityState.configurations[interaction.guildId];
        if (!configuration) {
            await interaction.reply({ content: 'Le panneau n’est pas encore configuré. Un responsable doit lancer `/identite-configurer`.', flags: MessageFlags.Ephemeral });
        } else if (!configuration.panelMessageId) {
            await interaction.reply({ content: 'La configuration est prête, mais le panneau n’est pas publié. Un responsable doit lancer `/identite-publier`.', flags: MessageFlags.Ephemeral });
        } else {
            await interaction.reply({ content: `La création se fait depuis le panneau dans <#${configuration.panelChannelId}>.`, flags: MessageFlags.Ephemeral });
        }
        return;
    }

    if (interaction.isChatInputCommand() && interaction.commandName === 'carte-identite') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        try {
            const record = await getFirebaseIdentityForDiscordUser(interaction.user.id);
            if (!record) {
                await interaction.editReply('Aucune carte validée n’est associée à ton compte Discord. Elle sera disponible après validation par un instructeur.');
                return;
            }
            await interaction.editReply({
                embeds: [buildPersonalIdentityEmbed(record.identity, record.dossier, interaction.user)],
                allowedMentions: { parse: [] }
            });
        } catch (error) {
            console.error(`Impossible de charger la carte d’identité de ${interaction.user.id} :`, error);
            await interaction.editReply('❌ Impossible de charger ta carte. Vérifie que le bot a accès à Firebase, puis contacte un responsable si le problème persiste.');
        }
        return;
    }

    if (interaction.isButton() && interaction.customId === 'identity:panel:create') {
        const configuration = identityState.configurations[interaction.guildId];
        if (!configuration?.panelMessageId
            || interaction.channelId !== configuration.panelChannelId
            || interaction.message.id !== configuration.panelMessageId) {
            await interaction.reply({ content: 'Ce panneau n’est plus actif. Demande à un responsable de le reconfigurer.', flags: MessageFlags.Ephemeral });
            return;
        }
        const sessionId = randomUUID();
        identitySessions.set(sessionId, {
            ownerId: interaction.user.id,
            guildId: interaction.guildId,
            step: 1,
            identity: {}
        });
        const cleanupTimer = setTimeout(() => identitySessions.delete(sessionId), 20 * 60 * 1000);
        cleanupTimer.unref();
        await interaction.showModal(buildIdentityRequestModal(1, sessionId));
        return;
    }

    if (interaction.isButton() && interaction.customId.startsWith('identity:request:open:')) {
        const [, , , stepValue, sessionId] = interaction.customId.split(':');
        const step = Number(stepValue);
        const session = identitySessions.get(sessionId);
        if (!session || session.ownerId !== interaction.user.id || session.guildId !== interaction.guildId) {
            await interaction.reply({ content: 'Cette session a expiré. Recommence depuis le panneau.', flags: MessageFlags.Ephemeral });
            return;
        }
        if (session.step !== step) {
            await interaction.reply({ content: 'Cette étape n’est plus active. Recommence depuis le panneau si nécessaire.', flags: MessageFlags.Ephemeral });
            return;
        }
        await interaction.showModal(buildIdentityRequestModal(step, sessionId));
        return;
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith('identity:request:submit:')) {
        const [, , , stepValue, sessionId] = interaction.customId.split(':');
        const step = Number(stepValue);
        const session = identitySessions.get(sessionId);
        if (!session || session.ownerId !== interaction.user.id || session.guildId !== interaction.guildId) {
            await interaction.reply({ content: 'Cette session a expiré. Recommence depuis le panneau.', flags: MessageFlags.Ephemeral });
            return;
        }
        if (session.step !== step) {
            await interaction.reply({ content: 'Cette étape a déjà été remplie. Recommence depuis le panneau si nécessaire.', flags: MessageFlags.Ephemeral });
            return;
        }

        const requiredFields = {
            1: ['lastName', 'firstNames', 'birthDate', 'birthPlace', 'nationality'],
            2: ['sex', 'address', 'engagementDate', 'motto']
        }[step];
        if (!requiredFields || requiredFields.some(field => !interaction.fields.getTextInputValue(field).trim())) {
            await interaction.reply({
                content: 'Tous les champs de cette étape doivent être renseignés.',
                components: [identityButton(`identity:request:open:${step}:${sessionId}`, 'Corriger cette étape')],
                flags: MessageFlags.Ephemeral
            });
            return;
        }
        if (step === 1) {
            const birthDate = interaction.fields.getTextInputValue('birthDate').trim();
            if (!isValidFrenchDate(birthDate)) {
                await interaction.reply({
                    content: 'Date de naissance invalide. Utilise le format JJ/MM/AAAA.',
                    components: [identityButton(`identity:request:open:1:${sessionId}`, 'Corriger la date')],
                    flags: MessageFlags.Ephemeral
                });
                return;
            }
            session.identity = {
                lastName: interaction.fields.getTextInputValue('lastName').trim(),
                firstNames: interaction.fields.getTextInputValue('firstNames').trim(),
                birthDate,
                birthPlace: interaction.fields.getTextInputValue('birthPlace').trim(),
                nationality: interaction.fields.getTextInputValue('nationality').trim()
            };
            session.step = 2;
            await interaction.reply({
                content: 'Première étape enregistrée temporairement. Continue avec les autres informations de la carte.',
                components: [identityButton(`identity:request:open:2:${sessionId}`, 'Continuer')],
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        const engagementDate = interaction.fields.getTextInputValue('engagementDate').trim();
        if (!isValidFrenchDate(engagementDate)) {
            await interaction.reply({
                content: 'Date d’engagement invalide. Utilise le format JJ/MM/AAAA.',
                components: [identityButton(`identity:request:open:2:${sessionId}`, 'Corriger la date')],
                flags: MessageFlags.Ephemeral
            });
            return;
        }
        session.identity = {
            ...session.identity,
            sex: interaction.fields.getTextInputValue('sex').trim(),
            address: interaction.fields.getTextInputValue('address').trim(),
            engagementDate,
            motto: interaction.fields.getTextInputValue('motto').trim()
        };
        const configuration = identityState.configurations[interaction.guildId];
        if (!configuration) {
            identitySessions.delete(sessionId);
            await interaction.reply({ content: 'Le panneau a été désactivé. Demande à un responsable de le reconfigurer.', flags: MessageFlags.Ephemeral });
            return;
        }

        const pendingRequest = Object.values(identityState.requests).find(request =>
            request.guildId === interaction.guildId
            && request.applicantId === interaction.user.id
            && request.status === 'pending'
        );
        if (pendingRequest) {
            identitySessions.delete(sessionId);
            await interaction.reply({
                content: `Tu as déjà une demande en attente (${pendingRequest.id.slice(0, 8)}). Attends son traitement avant d’en créer une autre.`,
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const requestId = randomUUID();
        const request = {
            id: requestId,
            guildId: interaction.guildId,
            applicantId: interaction.user.id,
            submittedAt: new Date().toISOString(),
            status: 'pending',
            identity: session.identity,
            dossier: { grade: '', mat: '', aff: '', notesPerso: '' },
            reviewChannelId: configuration.reviewChannelId,
            reviewMessageId: null
        };
        let reviewMessage;
        let wasSaved = false;
        try {
            const reviewChannel = await client.channels.fetch(configuration.reviewChannelId);
            if (!reviewChannel?.isTextBased() || !reviewChannel.messages) {
                throw new Error('Le salon privé des instructeurs est introuvable.');
            }
            identityState.requests[requestId] = request;
            await saveIdentityState();
            wasSaved = true;
            reviewMessage = await reviewChannel.send({
                embeds: [buildIdentityRequestEmbed(request)],
                components: [buildIdentityReviewControls(requestId)],
                allowedMentions: { parse: [] }
            });
            request.reviewMessageId = reviewMessage.id;
            await saveIdentityState();
        } catch (error) {
            if (wasSaved) {
                delete identityState.requests[requestId];
                try {
                    await saveIdentityState();
                } catch (rollbackError) {
                    console.error('Impossible de retirer la demande après échec de création :', rollbackError);
                }
            }
            if (reviewMessage) {
                try {
                    await reviewMessage.delete();
                } catch (cleanupError) {
                    console.error('Impossible de retirer le message de demande incomplet :', cleanupError);
                }
            }
            console.error('Échec de création d’une demande de carte :', error);
            await interaction.editReply('❌ La demande n’a pas pu être transmise. Réessaie plus tard ou contacte un responsable.');
            return;
        }
        identitySessions.delete(sessionId);
        await interaction.editReply('✅ Demande transmise aux instructeurs. Le grade, le matricule et l’affectation seront complétés par eux.');
        return;
    }

    if (interaction.isButton() && interaction.customId.startsWith('identity:review:edit:')) {
        const [, , , requestId] = interaction.customId.split(':');
        const request = identityState.requests[requestId];
        const configuration = identityState.configurations[interaction.guildId];
        if (!request || request.status !== 'pending' || request.reviewMessageId !== interaction.message.id) {
            await interaction.reply({ content: 'Cette demande n’est plus disponible.', flags: MessageFlags.Ephemeral });
            return;
        }
        if (!configuration || !hasIdentityInstructorRole(interaction, configuration)) {
            await interaction.reply({ content: 'Seuls les instructeurs autorisés peuvent compléter cette carte.', flags: MessageFlags.Ephemeral });
            return;
        }
        const sessionId = randomUUID();
        const data = {
            identity: { ...request.identity },
            dossier: { ...request.dossier }
        };
        identityEditSessions.set(sessionId, {
            ownerId: interaction.user.id,
            guildId: interaction.guildId,
            requestId,
            step: 1,
            data
        });
        const cleanupTimer = setTimeout(() => identityEditSessions.delete(sessionId), 20 * 60 * 1000);
        cleanupTimer.unref();
        await interaction.showModal(buildIdentityReviewModal(1, sessionId, data));
        return;
    }

    if (interaction.isButton() && interaction.customId.startsWith('identity:review:open:')) {
        const [, , , stepValue, sessionId] = interaction.customId.split(':');
        const step = Number(stepValue);
        const session = identityEditSessions.get(sessionId);
        const configuration = identityState.configurations[interaction.guildId];
        if (!session || session.ownerId !== interaction.user.id || session.guildId !== interaction.guildId) {
            await interaction.reply({ content: 'Cette session instructeur a expiré. Rouvre la demande.', flags: MessageFlags.Ephemeral });
            return;
        }
        if (!configuration || !hasIdentityInstructorRole(interaction, configuration)) {
            await interaction.reply({ content: 'Ton rôle ne permet pas de modifier cette carte.', flags: MessageFlags.Ephemeral });
            return;
        }
        if (session.step !== step) {
            await interaction.reply({ content: 'Cette étape n’est plus active.', flags: MessageFlags.Ephemeral });
            return;
        }
        await interaction.showModal(buildIdentityReviewModal(step, sessionId, session.data));
        return;
    }

    if (interaction.isButton() && interaction.customId.startsWith('identity:review:reject:')) {
        const [, , , requestId] = interaction.customId.split(':');
        const request = identityState.requests[requestId];
        const configuration = identityState.configurations[interaction.guildId];
        if (!request || request.status !== 'pending' || request.reviewMessageId !== interaction.message.id) {
            await interaction.reply({ content: 'Cette demande n’est plus disponible.', flags: MessageFlags.Ephemeral });
            return;
        }
        if (!configuration || !hasIdentityInstructorRole(interaction, configuration)) {
            await interaction.reply({ content: 'Seuls les instructeurs autorisés peuvent traiter cette demande.', flags: MessageFlags.Ephemeral });
            return;
        }
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const previousStatus = request.status;
        request.status = 'rejected';
        request.reviewedBy = interaction.user.id;
        request.reviewedAt = new Date().toISOString();
        try {
            await saveIdentityState();
        } catch (error) {
            request.status = previousStatus;
            delete request.reviewedBy;
            delete request.reviewedAt;
            console.error('Échec de sauvegarde du refus de carte :', error);
            await interaction.editReply('❌ Le refus n’a pas pu être enregistré localement.');
            return;
        }
        try {
            await updateIdentityReviewMessage(request);
            await interaction.editReply('Demande refusée.');
        } catch (error) {
            console.error('Refus enregistré, mais impossible d’actualiser le message instructeur :', error);
            await interaction.editReply('Demande refusée et enregistrée localement, mais le message instructeur n’a pas pu être actualisé.');
        }
        return;
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith('identity:review:submit:')) {
        const [, , , stepValue, sessionId] = interaction.customId.split(':');
        const step = Number(stepValue);
        const session = identityEditSessions.get(sessionId);
        const configuration = identityState.configurations[interaction.guildId];
        if (!session || session.ownerId !== interaction.user.id || session.guildId !== interaction.guildId) {
            await interaction.reply({ content: 'Cette session instructeur a expiré. Rouvre la demande.', flags: MessageFlags.Ephemeral });
            return;
        }
        if (!configuration || !hasIdentityInstructorRole(interaction, configuration)) {
            await interaction.reply({ content: 'Ton rôle ne permet pas de modifier cette carte.', flags: MessageFlags.Ephemeral });
            return;
        }
        const request = identityState.requests[session.requestId];
        if (!request || request.status !== 'pending' || session.step !== step) {
            await interaction.reply({ content: 'Cette demande ou cette étape n’est plus disponible.', flags: MessageFlags.Ephemeral });
            return;
        }

        const requiredFields = {
            1: ['lastName', 'firstNames', 'birthDate', 'birthPlace', 'nationality'],
            2: ['sex', 'address', 'engagementDate', 'motto'],
            3: ['grade', 'matricule', 'unit']
        }[step];
        if (!requiredFields || requiredFields.some(field => !interaction.fields.getTextInputValue(field).trim())) {
            await interaction.reply({
                content: 'Renseigne tous les champs obligatoires de cette étape.',
                components: [identityButton(`identity:review:open:${step}:${sessionId}`, 'Corriger cette étape')],
                flags: MessageFlags.Ephemeral
            });
            return;
        }
        if (step === 1) {
            const birthDate = interaction.fields.getTextInputValue('birthDate').trim();
            if (!isValidFrenchDate(birthDate)) {
                await interaction.reply({
                    content: 'Date de naissance invalide. Utilise le format JJ/MM/AAAA.',
                    components: [identityButton(`identity:review:open:1:${sessionId}`, 'Corriger la date')],
                    flags: MessageFlags.Ephemeral
                });
                return;
            }
            session.data.identity = {
                ...session.data.identity,
                lastName: interaction.fields.getTextInputValue('lastName').trim(),
                firstNames: interaction.fields.getTextInputValue('firstNames').trim(),
                birthDate,
                birthPlace: interaction.fields.getTextInputValue('birthPlace').trim(),
                nationality: interaction.fields.getTextInputValue('nationality').trim()
            };
            session.step = 2;
            await interaction.reply({
                content: 'Informations d’état civil vérifiées. Passe à la deuxième étape.',
                components: [identityButton(`identity:review:open:2:${sessionId}`, 'Étape 2 — carte')],
                flags: MessageFlags.Ephemeral
            });
            return;
        }
        if (step === 2) {
            const engagementDate = interaction.fields.getTextInputValue('engagementDate').trim();
            if (!isValidFrenchDate(engagementDate)) {
                await interaction.reply({
                    content: 'Date d’engagement invalide. Utilise le format JJ/MM/AAAA.',
                    components: [identityButton(`identity:review:open:2:${sessionId}`, 'Corriger la date')],
                    flags: MessageFlags.Ephemeral
                });
                return;
            }
            session.data.identity = {
                ...session.data.identity,
                sex: interaction.fields.getTextInputValue('sex').trim(),
                address: interaction.fields.getTextInputValue('address').trim(),
                engagementDate,
                motto: interaction.fields.getTextInputValue('motto').trim()
            };
            session.step = 3;
            await interaction.reply({
                content: 'Carte vérifiée. Renseigne maintenant les informations réservées à l’instructeur.',
                components: [identityButton(`identity:review:open:3:${sessionId}`, 'Étape 3 — dossier militaire')],
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        const enteredUnit = interaction.fields.getTextInputValue('unit').trim();
        const unit = IDENTITY_UNITS.find(item => item.toLocaleLowerCase('fr-FR') === enteredUnit.toLocaleLowerCase('fr-FR'));
        if (!unit) {
            await interaction.reply({
                content: `Unité non reconnue. Choisis une valeur exacte : ${IDENTITY_UNITS.join(' · ')}`,
                components: [identityButton(`identity:review:open:3:${sessionId}`, 'Corriger l’unité')],
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        session.data.dossier = {
            grade: interaction.fields.getTextInputValue('grade').trim(),
            mat: interaction.fields.getTextInputValue('matricule').trim(),
            aff: unit,
            notesPerso: interaction.fields.getTextInputValue('notes').trim()
        };
        const completedRequest = {
            ...request,
            identity: { ...session.data.identity },
            dossier: { ...session.data.dossier },
            status: 'completed',
            reviewedBy: interaction.user.id,
            reviewedAt: new Date().toISOString()
        };
        try {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        } catch (error) {
            console.error('Impossible de confirmer le traitement de la carte :', error);
            return;
        }

        let firebaseRecord;
        try {
            firebaseRecord = await saveFirebaseIdentityRecord(completedRequest);
        } catch (error) {
            console.error('Échec de synchronisation Firebase de la carte :', error);
            await interaction.editReply({
                content: '❌ La synchronisation Firebase a échoué. La demande reste en attente; vérifie la configuration et les accès Firebase, puis réessaie.',
                components: [identityButton(`identity:review:open:3:${sessionId}`, 'Réessayer la synchronisation')],
                allowedMentions: { parse: [] }
            });
            return;
        }
        completedRequest.firebaseIdentityKey = firebaseRecord.identityKey;
        completedRequest.firebaseEffectifKeys = firebaseRecord.effectifKeys;
        const previousRequest = JSON.parse(JSON.stringify(request));
        identityState.requests[request.id] = completedRequest;
        try {
            await saveIdentityState();
        } catch (error) {
            identityState.requests[request.id] = previousRequest;
            console.error('Carte synchronisée dans Firebase, mais échec de sauvegarde locale :', error);
            await interaction.editReply({
                content: '⚠️ La carte est dans Firebase, mais son état local n’a pas pu être enregistré. Réessaie : la synchronisation utilise la même fiche et ne créera pas de doublon.',
                components: [identityButton(`identity:review:open:3:${sessionId}`, 'Réessayer')],
                allowedMentions: { parse: [] }
            });
            return;
        }

        identityEditSessions.delete(sessionId);
        let messageUpdateFailed = false;
        try {
            await updateIdentityReviewMessage(completedRequest);
        } catch (error) {
            messageUpdateFailed = true;
            console.error('Carte synchronisée, mais impossible d’actualiser le message instructeur :', error);
        }
        const exportData = buildIdentityExport(completedRequest);
        const exportFile = new AttachmentBuilder(
            Buffer.from(JSON.stringify(exportData, null, 2), 'utf8'),
            { name: `dossier-${safeFileName(`${completedRequest.identity.firstNames}-${completedRequest.identity.lastName}`)}.json` }
        );
        await interaction.editReply({
            content: messageUpdateFailed
                ? '✅ Carte enregistrée dans Firebase. Le message du salon instructeurs n’a pas pu être actualisé.'
                : '✅ Carte vérifiée et synchronisée avec le dossier du site. Le JSON est joint.',
            embeds: [buildIdentityRequestEmbed(completedRequest)],
            files: [exportFile],
            allowedMentions: { parse: [] }
        });
        return;
    }

    // A. Ouverture de la fenêtre (Modal) lors de la commande /formation
    if (interaction.isChatInputCommand() && interaction.commandName === 'formation') {
        const modal = new ModalBuilder()
            .setCustomId('formationModal')
            .setTitle('Demande de Formation / Brevet');

        const nameInput = new TextInputBuilder()
            .setCustomId('userNameInput')
            .setLabel('Nom & Prénom')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Ex: Jean Dupont')
            .setRequired(true);

        const rankInput = new TextInputBuilder()
            .setCustomId('userRankInput')
            .setLabel('Grade')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Ex: Sergent')
            .setRequired(true);

        const idInput = new TextInputBuilder()
            .setCustomId('userMatriculeInput')
            .setLabel('Matricule (si absent : voir consignes)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Votre matricule ou "N/A"')
            .setRequired(true);

        const affectationInput = new TextInputBuilder()
            .setCustomId('userAffectationInput')
            .setLabel('Affectation (ex: 13e RDP, CPA 10, GCP...)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('N/A, Commando Jaubert, 13e RDP...')
            .setRequired(true);

        const formationTypeInput = new TextInputBuilder()
            .setCustomId('userFormationTypeInput')
            .setLabel('Formation / Brevet / Permis souhaité')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Ex: [CAT1] Brevet Caporal')
            .setRequired(true);

        modal.addComponents(
            new ActionRowBuilder().addComponents(nameInput),
            new ActionRowBuilder().addComponents(rankInput),
            new ActionRowBuilder().addComponents(idInput),
            new ActionRowBuilder().addComponents(affectationInput),
            new ActionRowBuilder().addComponents(formationTypeInput)
        );

        await interaction.showModal(modal);
    }

    // B. Réception des données du formulaire rempli par l'utilisateur
    if (interaction.isModalSubmit() && interaction.customId === 'formationModal') {
        await interaction.deferReply({ flags: 6 }); // Éphémère (visible par lui seul)

        const nomPrenom = interaction.fields.getTextInputValue('userNameInput');
        const grade = interaction.fields.getTextInputValue('userRankInput');
        const matricule = interaction.fields.getTextInputValue('userMatriculeInput');
        const affectation = interaction.fields.getTextInputValue('userAffectationInput');
        const formationType = interaction.fields.getTextInputValue('userFormationTypeInput');

        // Vérification si le joueur n'a pas de matricule
        let messageComplementaire = "";
        if (!matricule || matricule.toLowerCase() === 'aucun' || matricule.toLowerCase() === 'na' || matricule === 'N/A') {
            messageComplementaire = `\n\n⚠️ **Attention :** Aucun matricule valide détecté. Veuillez impérativement envoyer un mail à **A.Girond-MN@gouv.fr** (ou via le forum dédié sur le serveur) pour régulariser votre situation.`;
        }

        const formData = {
            discordId: interaction.user.id,
            username: interaction.user.username,
            nomPrenom: nomPrenom,
            grade: grade,
            matricule: matricule,
            affectation: affectation,
            formation: formationType,
            date: new Date().toISOString(),
            statut: 'En attente'
        };

        try {
            await saveFirebaseDemand(formData);
            await interaction.editReply(`✅ Votre demande pour **${formationType}** a été enregistrée avec succès dans la base de données !${messageComplementaire}`);
        } catch (error) {
            console.error("Échec d'enregistrement d'une demande Firebase :", error.message || error);
            await interaction.editReply('❌ Enregistrement Firebase impossible. Consulte les logs du bot pour le détail.');
        }
    }

});

// 3. Système de Bienvenue / Au revoir et Logs
client.on('guildMemberAdd', member => {
    const channel = member.guild.channels.cache.get('ID_SALON_BIENVENUE');
    if (!channel) return;
    channel.send(`🪂 Bienvenue sur le serveur des **Forces Spéciales Françaises**, ${member} ! Prépare-toi pour l'entraînement.`);
});

client.on('guildMemberRemove', member => {
    const channel = member.guild.channels.cache.get('ID_SALON_BIENVENUE');
    if (!channel) return;
    channel.send(`⚠️ ${member.user.tag} a quitté les rangs.`);
});

client.on('messageDelete', message => {
    if (message.author.bot) return;
    const logChannel = message.guild.channels.cache.get('ID_SALON_LOGS');
    if (!logChannel) return;
    logChannel.send(`📝 **Message supprimé** de ${message.author.tag} dans ${message.channel} :\n> ${message.content || '[Média ou Embed]'}`);
});

client.login(TOKEN).catch(error => {
    console.error('Impossible de connecter le bot Discord :', error.message);
    process.exitCode = 1;
});