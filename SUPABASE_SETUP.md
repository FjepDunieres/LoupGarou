# Guide de Configuration Supabase — Loup Garou Géant

Ce projet utilise **Supabase** pour synchroniser en temps réel les actions du Game Master (GM), les votes des joueurs, et l'affichage du Tableau.
Voici les étapes simples pour configurer votre base de données Supabase en moins de 5 minutes.

---

## 🚀 Étape 1 : Créer un Projet Supabase

1. Allez sur [Supabase.com](https://supabase.com) et connectez-vous (ou créez un compte gratuit).
2. Cliquez sur **New Project** (Nouveau projet).
3. Renseignez :
   - Le nom du projet (ex: `Loup Garou Geant`)
   - Un mot de passe de base de données (gardez-le précieusement)
   - La région la plus proche de chez vous (ex: *Western Europe* pour la France)
4. Cliquez sur **Create new project** et attendez que la configuration initiale soit terminée (environ 1-2 minutes).

---

## 🗄️ Étape 2 : Exécuter le Script SQL d'Initialisation

Une fois le projet prêt :
1. Dans le menu de gauche, cliquez sur **SQL Editor** (l'icône de terminal avec un éclair).
2. Cliquez sur **New Query** (Nouvelle requête).
3. Copiez et collez le script SQL suivant dans la console :

```sql
-- 1. Nettoyage des anciennes fonctions (pour mise à jour propre)
DROP FUNCTION IF EXISTS join_lobby(TEXT);
DROP FUNCTION IF EXISTS reset_game();

-- 2. Création de la table de l'état général du jeu
CREATE TABLE IF NOT EXISTS game_state (
    id INT PRIMARY KEY DEFAULT 1,
    phase TEXT DEFAULT 'lobby', -- 'lobby', 'night', 'day_announcement', 'day_discussion', 'day_vote', 'game_over'
    night_phase TEXT DEFAULT 'none', -- 'cupidon', 'voyante', 'loups', 'sorciere', 'garde', 'fluteur', 'none'
    timer_duration INT DEFAULT 0,
    timer_started_at TIMESTAMPTZ,
    announcement_text TEXT DEFAULT '',
    lovers JSONB DEFAULT '[]'::jsonb, -- Contient les UUID des deux amoureux
    witch_heal_used BOOLEAN DEFAULT FALSE,
    witch_poison_used BOOLEAN DEFAULT FALSE,
    current_night_kills JSONB DEFAULT '[]'::jsonb, -- Numéros ciblés par les loups
    current_night_saves JSONB DEFAULT '[]'::jsonb, -- Numéros sauvés par le garde
    current_night_poisons JSONB DEFAULT '[]'::jsonb, -- Numéros empoisonnés par la sorcière
    winners TEXT DEFAULT '',
    last_update TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT one_row CHECK (id = 1) -- Force l'existence d'une seule et unique ligne
);

-- Insérer l'état initial par défaut (si non présent)
INSERT INTO game_state (id, phase) 
VALUES (1, 'lobby') 
ON CONFLICT (id) DO NOTHING;

-- 3. Création de la table des joueurs
CREATE TABLE IF NOT EXISTS players (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    number INT UNIQUE, -- Numéro d'ordre unique attribué lors de l'inscription
    role TEXT DEFAULT NULL, -- Rôle distribué
    status TEXT DEFAULT 'alive', -- 'alive' ou 'dead'
    is_online BOOLEAN DEFAULT TRUE,
    last_seen TIMESTAMPTZ DEFAULT NOW(),
    charmed BOOLEAN DEFAULT FALSE, -- Indique si le joueur est charmé par le flûteur
    vote_target INT DEFAULT NULL, -- Numéro du joueur ciblé par le vote
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Fonction PL/pgSQL sécurisée pour rejoindre le lobby
-- Assure l'attribution d'un numéro incrémental unique de 1 à N de manière transactionnelle
CREATE OR REPLACE FUNCTION join_lobby(player_name TEXT)
RETURNS TABLE (player_id UUID, player_number INT) AS $$
DECLARE
    next_num INT;
    new_id UUID;
END;
$$ LANGUAGE plpgsql;
-- [NOTE: Le code complet de la fonction est défini ci-dessous]
```

Wait, let's copy the EXACT SQL from `schema.sql` so it is complete and not truncated!
Let's see the exact content of `schema.sql` again:
```sql
-- ==========================================================================
-- SCRIPT DE CONFIGURATION COMPLET POUR SUPABASE
-- Copiez et collez l'intégralité de ce script dans l'onglet SQL Editor de Supabase
-- ==========================================================================

-- 1. Nettoyage des anciennes fonctions (pour mise à jour propre)
DROP FUNCTION IF EXISTS join_lobby(TEXT);
DROP FUNCTION IF EXISTS reset_game();

-- 2. Création de la table de l'état général du jeu
CREATE TABLE IF NOT EXISTS game_state (
    id INT PRIMARY KEY DEFAULT 1,
    phase TEXT DEFAULT 'lobby', -- 'lobby', 'night', 'day_announcement', 'day_discussion', 'day_vote', 'game_over'
    night_phase TEXT DEFAULT 'none', -- 'cupidon', 'voyante', 'loups', 'sorciere', 'garde', 'fluteur', 'none'
    timer_duration INT DEFAULT 0,
    timer_started_at TIMESTAMPTZ,
    announcement_text TEXT DEFAULT '',
    lovers JSONB DEFAULT '[]'::jsonb, -- Contient les UUID des deux amoureux
    witch_heal_used BOOLEAN DEFAULT FALSE,
    witch_poison_used BOOLEAN DEFAULT FALSE,
    current_night_kills JSONB DEFAULT '[]'::jsonb, -- Numéros ciblés par les loups
    current_night_saves JSONB DEFAULT '[]'::jsonb, -- Numéros sauvés par le garde
    current_night_poisons JSONB DEFAULT '[]'::jsonb, -- Numéros empoisonnés par la sorcière
    winners TEXT DEFAULT '',
    last_update TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT one_row CHECK (id = 1) -- Force l'existence d'une seule et unique ligne
);

-- Insérer l'état initial par défaut (si non présent)
INSERT INTO game_state (id, phase) 
VALUES (1, 'lobby') 
ON CONFLICT (id) DO NOTHING;

-- 3. Création de la table des joueurs
CREATE TABLE IF NOT EXISTS players (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    number INT UNIQUE, -- Numéro d'ordre unique attribué lors de l'inscription
    role TEXT DEFAULT NULL, -- Rôle distribué
    status TEXT DEFAULT 'alive', -- 'alive' ou 'dead'
    is_online BOOLEAN DEFAULT TRUE,
    last_seen TIMESTAMPTZ DEFAULT NOW(),
    charmed BOOLEAN DEFAULT FALSE, -- Indique si le joueur est charmé par le flûteur
    vote_target INT DEFAULT NULL, -- Numéro du joueur ciblé par le vote
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Fonction PL/pgSQL sécurisée pour rejoindre le lobby
-- Assure l'attribution d'un numéro incrémental unique de 1 à N de manière transactionnelle
CREATE OR REPLACE FUNCTION join_lobby(player_name TEXT)
RETURNS TABLE (player_id UUID, player_number INT) AS $$
DECLARE
    next_num INT;
    new_id UUID;
BEGIN
    -- Verrouiller la table pour éviter les collisions de numéros lors de connexions simultanées
    LOCK TABLE players IN SHARE ROW EXCLUSIVE MODE;

    -- Obtenir le prochain numéro disponible
    SELECT COALESCE(MAX(number), 0) + 1 INTO next_num FROM players;
    
    new_id := gen_random_uuid();
    
    INSERT INTO players (id, name, number, status, is_online)
    VALUES (new_id, player_name, next_num, 'alive', true);
    
    RETURN QUERY SELECT new_id, next_num;
END;
$$ LANGUAGE plpgsql;

-- 5. Fonction PL/pgSQL pour réinitialiser la partie
-- Nettoie la table des joueurs et remet l'état général à zéro
CREATE OR REPLACE FUNCTION reset_game()
RETURNS VOID AS $$
BEGIN
    DELETE FROM players;
    
    UPDATE game_state SET
        phase = 'lobby',
        night_phase = 'none',
        timer_duration = 0,
        timer_started_at = NULL,
        announcement_text = '',
        lovers = '[]'::jsonb,
        witch_heal_used = FALSE,
        witch_poison_used = FALSE,
        current_night_kills = '[]'::jsonb,
        current_night_saves = '[]'::jsonb,
        current_night_poisons = '[]'::jsonb,
        winners = '',
        last_update = NOW()
    WHERE id = 1;
END;
$$ LANGUAGE plpgsql;

-- 6. Activation sécurisée du système temps réel (Realtime)
-- Permet d'éviter les crashs si le système est déjà actif sur ces tables
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' AND tablename = 'players'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE players;
    END IF;
    
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' AND tablename = 'game_state'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE game_state;
    END IF;
END $$;
```

4. Cliquez sur le bouton vert **Run** en bas à droite pour exécuter la requête. Vous devriez obtenir un message de succès.

---

## 🔐 Étape 3 : Créer le Compte du Game Master

Le Game Master se connecte à l'adresse `admin@admin.fr` avec l'authentification sécurisée de Supabase. Pour configurer ce compte :
1. Dans le menu de gauche de Supabase, cliquez sur **Authentication** (icône de cadenas).
2. Cliquez sur le bouton **Add User** (Ajouter un utilisateur) -> **Create User**.
3. Renseignez :
   - Email: `admin@admin.fr`
   - Mot de passe de votre choix (ex: `LoupGarou2026!`)
4. Cochez **Auto-confirm User** (très important pour que le compte soit immédiatement actif sans confirmation d'email).
5. Cliquez sur **Save**.

---

## 🔑 Étape 4 : Obtenir vos clés d'accès API

1. Dans le menu de gauche, cliquez sur **Project Settings** (l'icône d'engrenage tout en bas).
2. Cliquez sur l'onglet **API**.
3. Dans cette section, copiez :
   - **Project URL** (sous la mention *Project URL*)
   - **anon / public** (sous la mention *Project API keys*)
4. Collez ces deux chaînes dans les champs correspondants de l'assistant de configuration lors de l'ouverture du site, ou écrivez-les directement dans le fichier `config.js` pour figer la configuration :
   ```javascript
   const CONFIG = {
     SUPABASE_URL: "https://votre-id.supabase.co",
     SUPABASE_ANON_KEY: "votre-cle-anon"
   };
   ```

---

## 🎨 Note sur les Rôles de Jeu
L'application intègre 11 rôles stratégiques :
- **Loup-Garou** (meute coordonnée)
- **Simple Villageois**
- **Voyante** (inspection nocturne)
- **Sorcière** (potion de vie et mort)
- **Chasseur** (tir ultime)
- **Cupidon** (liaison de 2 amoureux)
- **Garde** (protection nocturne)
- **Flûteur** (envoûte le village)
- **Idiot du village** (survit au vote)
- **Ancien** (survit aux loups)
- **Ange** (doit se faire élire jour 1)

Tous les visuels de ces rôles ont déjà été générés par IA et sont stockés dans le dossier `assets/` de votre projet.
