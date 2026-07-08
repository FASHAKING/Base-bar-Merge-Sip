// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title DrinkTally — onchain tally + best scores for Merge Sip
/// @notice Every finished game can be "served" onchain: it bumps a global
///         tally and records the player's personal best score and best drink.
contract DrinkTally {
    /// @notice Global count of games served onchain by all players.
    uint256 public totalServed;

    /// @notice Personal best score per player.
    mapping(address => uint256) public bestScore;

    /// @notice Highest drink tier (0-9) the player has ever mixed.
    mapping(address => uint8) public bestTier;

    event ScoreServed(
        address indexed player,
        uint256 score,
        uint8 tier,
        uint256 totalServed
    );

    /// @notice Record a finished game.
    /// @param score The final score of the run.
    /// @param tier  The highest drink tier reached this run (0-9).
    function serveScore(uint256 score, uint8 tier) external {
        require(tier <= 9, "bad tier");
        totalServed += 1;
        if (score > bestScore[msg.sender]) {
            bestScore[msg.sender] = score;
        }
        if (tier > bestTier[msg.sender]) {
            bestTier[msg.sender] = tier;
        }
        emit ScoreServed(msg.sender, score, tier, totalServed);
    }
}
