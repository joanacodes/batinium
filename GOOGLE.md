# Batinium — brancher Google (boîte mail et agenda)

Rien de la partie e-mail ne fonctionne tant que ceci n'est pas fait. Ce n'est
pas du code : c'est une autorisation que Google doit vous accorder, et personne
ne peut la demander à votre place.

Comptez trente minutes la première fois.

---

## Ce qu'on met en place, et pourquoi

Batinium ne stocke aucun mot de passe. Il demande à Google une autorisation
limitée — lire la boîte, envoyer en votre nom, lire l'agenda — que vous pouvez
retirer à tout moment depuis votre compte Google.

Deux niveaux, à ne pas confondre.

L'**autorisation courte** dure une heure. C'est ce qui existe aujourd'hui :
Batinium lit votre boîte tant que l'onglet est ouvert, puis s'arrête.

L'**autorisation longue** — le jeton de rafraîchissement — permet au serveur de
relever la boîte toutes les cinq minutes, même onglet fermé, même la nuit.
C'est elle qu'il faut pour qu'un formulaire rempli à 23 h devienne une demande
avant votre réveil. Google ne la donne que si on la demande explicitement, et
c'est le point que la configuration ci-dessous rend possible.

---

## 1. Créer le projet Google

1. Ouvrez [console.cloud.google.com](https://console.cloud.google.com).
2. En haut à gauche, le sélecteur de projet → **Nouveau projet**.
   Nommez-le `Batinium`.
3. Une fois créé, sélectionnez-le.

## 2. Activer les deux interfaces

Menu → **API et services** → **Bibliothèque**. Cherchez et activez :

- **Gmail API**
- **Google Calendar API**

Sans cette étape, l'autorisation sera accordée mais chaque lecture répondra
« API non activée ».

## 3. L'écran de consentement

Menu → **API et services** → **Écran de consentement OAuth**.

- Type d'utilisateur : **Externe**, sauf si Pilotech a un Google Workspace,
  auquel cas **Interne** évite toute validation.
- Nom de l'application : `Batinium`
- Adresse d'assistance et de contact : `info.pilotech@gmail.com`
- **Domaines autorisés** : votre domaine Vercel, et `supabase.co`

Puis, à l'étape **Champs d'application**, ajoutez :

```
https://www.googleapis.com/auth/gmail.readonly
https://www.googleapis.com/auth/gmail.send
https://www.googleapis.com/auth/calendar.readonly
```

`gmail.send` sert à répondre depuis Batinium. Le message part réellement de la
boîte de Fabrice, apparaît dans ses « Envoyés », et la réponse du client arrive
dans son fil habituel.

À l'étape **Utilisateurs test**, ajoutez `info.pilotech@gmail.com` et toute
autre adresse qui se connectera.

> **Le piège à connaître.** Tant que l'application reste « en test », Google
> révoque le jeton long au bout de **sept jours** : la synchronisation
> s'arrêterait chaque semaine. Pour un usage durable il faut passer
> l'application en **production** — bouton sur le même écran. Avec ces
> champs-là, Google demande une vérification, qui prend quelques jours et
> demande une vidéo de démonstration. À anticiper.

## 4. Les identifiants

Menu → **API et services** → **Identifiants** → **Créer des identifiants** →
**ID client OAuth**.

- Type : **Application Web**
- Nom : `Batinium`
- **URI de redirection autorisés** — exactement ceci, une ligne :

```
https://sryazbmnhgbtfjvyakgd.supabase.co/auth/v1/callback
```

Copiez l'**ID client** et le **code secret du client**. Le secret ne s'affiche
qu'une fois.

## 5. Côté Supabase

Tableau de bord → **Authentication** → **Sign In / Providers** → **Google**.

- Activez le fournisseur
- Collez l'ID client et le secret
- Enregistrez

Puis **Authentication** → **URL Configuration** → **Redirect URLs**. Ajoutez :

```
http://localhost:5175
https://votre-adresse.vercel.app
```

Sans ces deux lignes, le retour de Google atterrit ailleurs et la connexion
échoue sans message clair.

## 6. Vérifier

Dans Batinium : **Connexions** → carte **Google** → **Connecter Google**.

Google demande votre consentement, vous revenez, la carte passe au vert et
affiche le nombre d'événements de la semaine.

---

## Et pour les autres entreprises

Vous avez raison de le soulever : Batinium est destiné à être revendu, et tous
les clients ne seront pas sur Gmail.

**Un client sur Gmail ou Workspace** n'a rien à faire. Il clique « Connecter
Google » et c'est réglé — la configuration ci-dessus est faite **une fois**,
par vous, pour toutes les entreprises. Chaque gérant n'accorde que son propre
consentement.

**Un client sur Outlook, OVH, IONOS** aura besoin d'un autre chemin. Deux
possibilités, et elles ne se valent pas :

*Lire et envoyer via son propre serveur* — IMAP en lecture, SMTP en envoi. Le
courrier part de sa vraie adresse, aucune configuration DNS n'est nécessaire,
et c'est la voie que je recommanderai. Il faut lui demander ses réglages, ce
qui est plus rebutant qu'un bouton.

*Envoyer depuis un serveur au nom de son domaine* — c'est là, et seulement là,
que DKIM, SPF et DMARC entrent en jeu. Trois enregistrements DNS à poser chez
son hébergeur, sans lesquels ses devis partiraient en indésirables. C'est la
seule solution si l'on veut un envoi qui ne dépende d'aucune boîte
personnelle — utile le jour où Batinium enverra des relances automatiques.

Les deux sont à construire, et aucune n'est un préalable à Gmail. On commence
par le cas de Fabrice, on ajoute les autres quand un client les demande.
