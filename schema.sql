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
